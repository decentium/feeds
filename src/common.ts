import * as bunyan from 'bunyan'
import * as config from 'config'

interface LogStream {
    level: bunyan.LogLevel
    out: string
}

const logStreams = config.get('log') as LogStream[]
if (
    !Array.isArray(logStreams) ||
    logStreams.length === 0 ||
    !logStreams.every((s) => s.level && s.out)
) {
    throw new Error('Invalid log configuration')
}

export const logger = bunyan.createLogger({
    name: config.get('name'),
    streams: logStreams.map(({level, out}) => {
        if (out === 'stdout') {
            return {level, stream: process.stdout}
        } else if (out === 'stderr') {
            return {level, stream: process.stderr}
        } else if (out.startsWith('loggly:')) {
            const Bunyan2Loggly = require('bunyan-loggly')
            const [_, subdomain, token] = out.split(':')
            const stream = new Bunyan2Loggly({subdomain, token}, 5, 500)
            return {level, type: 'raw', stream}
        } else {
            return {level, path: out}
        }
    }),
})
