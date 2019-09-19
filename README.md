
decentium-feeds
===============

Feed service for the the decentralized publishing platform [Decentium](https://decentium.org)

Developing
----------

With node.js installed, run `make dev`. See `config/default.toml` for configuration options.

Run with docker
---------------

```
$ docker build .
...
<container id>
$ docker run -d --name decentium-feeds \
    -e EOSIO_NODE="https://eos.greymass.com" \
    <container id>
```

Deploying
---------

The service is designed to sit behind a proxy cache and/or CDN that respects `Cache-Control` directives. Memory consumption will be proportional to size of the block cache and can be tweaked with the `BLOCK_CACHE_SIZE` env var.

See the `config/` for more configuration options.