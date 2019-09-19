import * as assert from 'assert'
import * as config from 'config'
import {Feed} from 'feed'
import * as http from 'http'
import {parse as parseQs} from 'querystring'
import {parse as parseUrl} from 'url'
import {logger} from './common'
import {buildBlogFeed, buildTrendingFeed} from './feed'
import version from './version'

function isName(value: string) {
    return /^[a-z1-5.]{1,13}$/.test(value)
}

function writeFeed(res: http.ServerResponse, feed: Feed | null, type: string) {
    if (!feed) {
        res.writeHead(400)
        res.end()
        return
    }
    let contentType: string
    let feedContents: string
    switch (type) {
        case 'json':
            feedContents = feed.json1()
            contentType = 'application/json'
            break
        case 'atom':
            feedContents = feed.atom1()
            contentType = 'application/atom+xml'
            break
        case 'rss':
            feedContents = feed.rss2()
            contentType = 'application/rss+xml'
            break
        default:
            throw new Error('Invalid feed type')
    }
    const data = Buffer.from(feedContents, 'utf8')
    res.writeHead(200, {
        'Content-Type': `${contentType}; charset=utf-8`,
        'Content-Length': data.byteLength,
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=600, stale-if-error=86400',
    })
    res.end(data)
}

async function timeBlock(block: () => Promise<void>) {
    const start = Date.now()
    await block()
    return Date.now() - start
}

async function feedHandler(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method !== 'GET') {
        res.writeHead(405)
        res.end()
        return
    }
    const url = parseUrl(req.url || '')
    const query = parseQs(url.query || '')
    const paths = (url.pathname || '/').split('/').filter((p) => p.length > 0)
    const feedType = query.type || 'atom'
    if (typeof feedType !== 'string' || !['json', 'rss', 'atom'].includes(feedType)) {
        res.writeHead(400)
        res.end('Invalid feed type')
        return
    }
    if (!paths.every(isName)) {
        res.writeHead(400)
        res.end('Invalid name')
        return
    }
    if ((paths.length === 2 && paths[0] === 'topic') || paths.length === 0) {
        const category = paths[1]
        logger.debug({category}, 'rendering trending feed')
        const renderTime = await timeBlock(async () => {
            writeFeed(res, await buildTrendingFeed(category), feedType)
        })
        logger.info({renderTime, feedType, category}, 'rendered trending feed')
    } else if (paths.length === 1) {
        const author = paths[0]
        logger.debug('rendering feed for %s', author)
        const renderTime = await timeBlock(async () => {
            writeFeed(res, await buildBlogFeed(author), feedType)
        })
        logger.info({renderTime, feedType}, 'rendered feed for %s', author)
    } else {
        res.writeHead(404)
        res.end()
    }
}

export async function main() {
    logger.info({version}, 'starting')
    const server = http.createServer((req, res) => {
        feedHandler(req, res).catch((error) => {
            if (!res.finished) {
                res.writeHead(500)
                res.end()
            }
            logger.error(error, 'exception in feed handler')
        })
    })
    const port = parseInt(config.get('port'), 10)
    assert(isFinite(port), 'invalid port number')
    server.listen(port, () => {
        logger.info('listening on %d', port)
    })
    return server
}

function exit(code: number, timeout = 3000) {
    // give loggers chance to flush
    process.exitCode = code
    setTimeout(() => {
        process.exit(code)
    }, timeout)
}

if (module === require.main) {
    process.on('unhandledRejection', (error) => {
        logger.fatal(error, 'unhandled rejection')
        exit(1)
    })
    process.on('uncaughtException', (error) => {
        logger.fatal(error, 'uncaught exception')
        exit(1)
    })
    main()
        .then((server) => {
            const gracefulExit = () => {
                logger.info('caught signal, exiting...')
                server.close((error) => {
                    if (error) {
                        logger.error(error, 'error closing http server')
                    }
                    exit(0)
                })
                exit(0, 5000) // make sure we always exit
            }
            process.on('SIGTERM', gracefulExit)
            process.on('SIGINT', gracefulExit)
        })
        .catch((error) => {
            logger.fatal(error, 'unable to start application')
            exit(1)
        })
}
