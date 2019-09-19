import * as config from 'config'
import {ApiClient, encodePermlink, EosjsDataProvider, render} from 'decentium'
import {JsonRpc} from 'eosjs'
import {Feed} from 'feed'
import PQueue from 'p-queue'
import {logger as baseLogger} from './common'
import version from './version'

import * as ABI from 'decentium/contract/types'

type FeedItem = Parameters<Feed['addItem']>[0]

const contractAccount = config.get('contract_account') as string
const blockCacheSize = parseInt(config.get('block_cache_size'), 10)
const mainUrl = config.get('main_url') as string
const feedUrl = config.get('feed_url') as string
const nodeUrl = config.get('eosio_node') as string
const generator = `decentium-feeds/${version} (+https://github.com/decentium/feeds)`

const logger = baseLogger.child({module: 'feed'})
const rpc = new JsonRpc(nodeUrl, {fetch: require('node-fetch')})
const dataProvider = new EosjsDataProvider(rpc, {blockCacheSize, whitelist: [contractAccount]})
const api = new ApiClient({dataProvider, contract: contractAccount})

const queue = new PQueue({
    concurrency: parseInt(config.get('fetch_concurrency'), 10),
    timeout: 5 * 60 * 1000,
    throwOnTimeout: true,
})

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1).toLowerCase()

export async function buildBlogFeed(author: string) {
    const blog = await api.getBlog(author)
    if (!blog) {
        return null
    }
    const profileRef = blog.profile
    let profile: ABI.ActionProfile | undefined
    if (profileRef) {
        try {
            profile = await queue.add(() => api.resolveProfile(profileRef))
        } catch (error) {
            logger.warn(error, 'unable to resolve profile for %s', author)
        }
    }
    const displayName = profile ? profile.name : author
    const authorUrl = `${mainUrl}/${author}`
    const authorFeedUrl = `${feedUrl}/${author}`
    const {posts} = await api.getPosts(author, undefined, 500) // FUTURE: feed pagination
    const tasks = posts.map((ref) => async () => {
        logger.debug({ref}, 'render post')
        let post: ABI.ActionPost
        try {
            post = await api.resolvePost(ref)
        } catch (error) {
            logger.warn(
                error,
                'unable to resolve post %s%s',
                ref.permlink.author,
                ref.permlink.slug
            )
            return null
        }
        return {
            title: post.title,
            link: `${authorUrl}/${encodePermlink(ref.permlink)}`,
            date: new Date(ref.timestamp + 'Z'),
            content: render(post.doc),
            description: post.metadata ? post.metadata.summary : undefined,
            image: post.metadata ? post.metadata.image : undefined,
            extensions: [{
                name: 'topic',
                objects: ref.category,
            }],
        } as FeedItem
    })
    const items = (await queue.addAll(tasks)).filter((item) => item !== null) as FeedItem[]
    const updated = items[0] ? items[0].date : new Date(0)
    const feed = new Feed({
        id: authorUrl,
        link: authorUrl,
        title: `${displayName} on Decentium`,
        copyright: `All rights reserved, ${displayName}`,
        description: profile ? profile.bio : undefined,
        generator,
        updated,
        author: {
            name: displayName,
            link: authorUrl,
        },
        feedLinks: {
            atom: authorFeedUrl,
            rss: `${authorFeedUrl}?format=rss`,
            json: `${authorFeedUrl}?format=json`,
        },
    })
    items.forEach((item) => feed.addItem(item))
    return feed
}

export async function buildTrendingFeed(category?: string) {
    const trending = await api.getTrending({limit: 50, category})
    const topicPath = category ? `/topic/${category}` : ''
    const topicUrl = mainUrl + topicPath
    const topicFeedUrl = feedUrl + topicPath
    const tasks = trending.posts.map((ref) => async () => {
        logger.debug({ref}, 'render post')
        let post: ABI.ActionPost
        try {
            post = await api.resolvePost(ref)
        } catch (error) {
            logger.warn(
                error,
                'unable to resolve post %s%s',
                ref.permlink.author,
                ref.permlink.slug
            )
            return null
        }
        let profile: ABI.ActionProfile | null = null
        try {
            profile = await api.getProfile(ref.permlink.author)
        } catch (error) {
            logger.warn(error, 'unable to resolve profile for %s', ref.permlink.author)
        }
        return {
            title: post.title,
            link: `${mainUrl}/${encodePermlink(ref.permlink)}`,
            date: new Date(ref.timestamp + 'Z'),
            content: render(post.doc),
            description: post.metadata ? post.metadata.summary : undefined,
            image: post.metadata ? post.metadata.image : undefined,
            author: [
                {
                    name: profile ? profile.name : ref.permlink.author,
                    link: `${mainUrl}/${ref.permlink.author}`,
                },
            ],
        } as FeedItem
    })
    const items = (await queue.addAll(tasks)).filter((item) => item !== null) as FeedItem[]
    const updated = items[0] ? items[0].date : new Date(0)
    const feed = new Feed({
        id: topicUrl,
        link: topicUrl,
        title: `${category ? capitalize(category) : 'Trending'} on Decentium`,
        copyright: 'All rights reserved, respective authors.',
        generator,
        updated,
        feedLinks: {
            atom: topicFeedUrl,
            rss: `${topicFeedUrl}?format=rss`,
            json: `${topicFeedUrl}?format=json`,
        },
    })
    items.forEach((item) => feed.addItem(item))
    return feed
}
