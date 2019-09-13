import * as config from 'config'
import {ApiClient, encodePermlink, EosjsDataProvider, render} from 'decentium'
import {JsonRpc} from 'eosjs'
import {Feed} from 'feed'
import {logger as baseLogger} from './common'
import version from './version'

import * as ABI from 'decentium/contract/types'

const logger = baseLogger.child({module: 'feed'})
const blockCacheSize = parseInt(config.get('block_cache_size'), 10)
const rpc = new JsonRpc(config.get('eosio_node'), {fetch: require('node-fetch')})
const dataProvider = new EosjsDataProvider(rpc, {blockCacheSize, whitelist: ['decentiumorg']})
const api = new ApiClient({dataProvider})

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1).toLowerCase()

export async function buildBlogFeed(author: string) {
    const blog = await api.getBlog(author)
    if (!blog) {
        return null
    }
    let profile: ABI.ActionProfile | undefined
    if (blog.profile) {
        try {
            profile = await api.resolveProfile(blog.profile)
        } catch (error) {
            logger.warn(error, 'unable to resolve profile for %s', author)
        }
    }
    const displayName = profile ? profile.name : author
    // TODO: configurable base urls
    const baseUrl = `https://decentium.org/${ author }`
    const feedUrl = `https://feeds.decentium.org/${ author }`
    const feed = new Feed({
        id: baseUrl,
        link: baseUrl,
        title: `${ displayName } on Decentium`,
        copyright: `All rights reserved, ${ displayName }`,
        description: profile ? profile.bio : undefined,
        generator: `decentium-feeds/${ version } (+https://github.com/decentium/feeds)`,
        author: {
            name: displayName,
            link: baseUrl,
        },
        feedLinks: {
            atom: feedUrl,
            rss: `${ feedUrl }?type=rss`,
            json: `${ feedUrl }?type=json`,
        }
    })
    const {posts} = await api.getPosts(author, undefined, 500) // FUTURE: feed pagination
    for (const ref of posts) {
        let post: ABI.ActionPost
        try {
            post = await api.resolvePost(ref)
        } catch (error) {
            logger.warn(error, 'unable to resolve post %s%s', ref.permlink.author, ref.permlink.slug)
            continue
        }
        feed.addItem({
            title: post.title,
            link: `${ baseUrl }/${ encodePermlink(ref.permlink) }`,
            date: new Date(ref.timestamp + 'Z'),
            content: render(post.doc),
            description: post.metadata ? post.metadata.summary : undefined,
            image: post.metadata ? post.metadata.image : undefined,
        })
    }
    return feed
}

export async function buildTrendingFeed(category?: string) {
    const trending = await api.getTrending({limit: 50, category})
    const topicPath = category ? `/topic/${ category }` : ''
    // TODO: configurable base urls
    const baseUrl = `https://decentium.org${ topicPath }`
    const feedUrl = `https://feeds.decentium.org${ topicPath }`
    const feed = new Feed({
        id: baseUrl,
        link: baseUrl,
        title: `${ category ? capitalize(category) : 'Trending' } on Decentium`,
        copyright: 'All rights reserved, respective authors.',
        generator: `decentium-feeds/${ version } (+https://github.com/decentium/feeds)`,
        feedLinks: {
            atom: feedUrl,
            rss: `${ feedUrl }?type=rss`,
            json: `${ feedUrl }?type=json`,
        }
    })
    for (const ref of trending.posts) {
        let post: ABI.ActionPost
        try {
            post = await api.resolvePost(ref)
        } catch (error) {
            logger.warn(error, 'unable to resolve post %s%s', ref.permlink.author, ref.permlink.slug)
            continue
        }
        let profile: ABI.ActionProfile | null = null
        try {
            profile = await api.getProfile(ref.permlink.author)
        } catch (error) {
            logger.warn(error, 'unable to resolve profile for %s', ref.permlink.author)
        }
        feed.addItem({
            title: post.title,
            link: `https://decentium.org/${ encodePermlink(ref.permlink) }`,
            date: new Date(ref.timestamp + 'Z'),
            content: render(post.doc),
            description: post.metadata ? post.metadata.summary : undefined,
            image: post.metadata ? post.metadata.image : undefined,
            author: [{
                name: profile ? profile.name : ref.permlink.author,
                link: `https://decentium.org/${ ref.permlink.author }`,
            }]
        })
    }
    return feed
}
