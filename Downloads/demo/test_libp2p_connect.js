const ip = require("ip");
const log = require("debug")("exp");
const fs = require("fs");
const libp2p = require("libp2p");
const KadDHT = require("libp2p-kad-dht");
const MulticastDNS = require("libp2p-mdns");
const Bootstrap = require("libp2p-bootstrap");
const TCP = require("libp2p-tcp");
const WS = require("libp2p-websockets");
const WebSocketStar = require("libp2p-websocket-star");
const MPLEX = require("libp2p-mplex");
const SPDY = require("libp2p-spdy");
const SECIO = require("libp2p-secio");
const defaultsDeep = require("@nodeutils/defaults-deep");
const pull = require("pull-stream");
const promisify = require("promisify-es6");
const get = require("lodash/get");
const PeerInfo = require("peer-info");
const parallel = require("async/parallel");
const waterfall = require("async/waterfall");
const series = require("async/series");
const each = require("async/each");
const PeerId = require("peer-id");
const CID = require("cids");
const multihash = require("multihashes");
const Pushable = require("pull-pushable");

const dialAddr = ["/ip4/0.0.0.0/tcp/4001", "/ip4/127.0.0.1/tcp/4002/ws"];
const bootstrap = [
    //relay node on server(47.97.188.238:8005)
    "/ip4/47.97.188.238/tcp/8005/ipfs/QmTojCuQXSD29bV1Nqh3Fcn3D71vaPz4nDkGfVTaWfjxm1",
];

/* 
 * libp2p node construction, use input config to cover default config.
 * _options: input config
 * defaults: default config
 * Note: for nodejs, gets replaced by browser version when webpacked/browserified
 */
class Node extends libp2p {
    constructor(_options) {
        const wsstar = new WebSocketStar({ id: _options.peerInfo.id });

        const defaults = {
            //limit the connection managers peers and have it check peer health less frequently
            connectionManager: {
                maxPeers: 25,
                pollInterval: 5000
            },
            modules: {
                transport: [
                    TCP,
                    WS,
                    wsstar
                ],
                streamMuxer: [
                    MPLEX,
                    SPDY
                ],
                connEncryption: [
                    SECIO
                ],
                peerDiscovery: [
                    MulticastDNS,
                    Bootstrap,
                    wsstar.discovery
                ],
                dht: KadDHT
            },
            config: {
                peerDiscovery: {
                    mdns: {
                        //run at 1s so we can observe more quickly, default is 10s
                        interval: 10000,
                        enabled: true
                    },
                    bootstrap: {
                        interval: 10000,
                        enabled: true,
                        list: bootstrap
                    },
                    websocketStar: {
                        enabled: true
                    }
                },
                // Turn on relay with hop active so we can connect to more peers
                relay: {
                    enabled: true,
                    hop: {
                        enabled: true,
                        active: true
                    }
                },
                dht: {
                    kBucketSize: 20
                },
                EXPERIMENTAL: {
                    //set true to enable the function
                    dht: true,
                    pubsub: true
                }
            }
        };

        //deep copy, do not change source object and merge arrays.
        super(defaultsDeep(_options, defaults));
    }
}

/*
 * create peerinfo and then create node.
 * input addrs might be array, one for dialer and another for listener.
 */
function createNode(addrs, callback) {
    if (!Array.isArray(addrs)) {
        addrs = [addrs];
    }
    let node;

    waterfall([
        (cb) => PeerInfo.create(cb),
        (peerInfo, cb) => {
            addrs.forEach((addr) => peerInfo.multiaddrs.add(addr));
            node = new Node({ peerInfo: peerInfo });
            // console.log('node:', node)
            node.start(cb);
        }
    ], (err) => callback(err, node));
}

/* print all multiaddr of peerinfo */
function printAddrs(nodes) {
    if (!Array.isArray(nodes)) {
        nodes = [nodes];
    }
    nodes.forEach((node) => {
        log("Creating node %s, multiaddrs:", node.peerInfo.id.toB58String());
        console.log("Creating node %s, multiaddrs:", node.peerInfo.id.toB58String())
        node.peerInfo.multiaddrs.forEach((ma) => log("\t" + ma.toString()));
    });
}

/*
 * this is useful to keep connection alive.
 * listen on discovery/connect event.
 * at least can discovery the peer in bootstrap list.
 */
function discovery(node) {
    node.on("peer:discovery", (peerInfo) => {
        log("Discovered node: %s", peerInfo.id.toB58String());
        peerInfo.multiaddrs.forEach((ma) => log("\t" + ma.toString()));
        node.dial(peerInfo, () => { });
    });
    node.on("peer:connect", (peerInfo) => {
        console.log("Connection established to node: %s", peerInfo.id.toB58String());
    });
    node.on("peer:disconnect", (peerInfo) => {
        console.log("Connection closed to node: %s", peerInfo.id.toB58String());
    });

     
    var peer = '/ip4/10.197.163.4/tcp/4002/ipfs/Qmepxu6S132MZyCsz5kwV5rERrRWccVmK5swXkGGjaMRsj'
    console.log('node dial peer: ', peer)
    node.dial(peer, (err) => {
	    if(err)
	    {
		    console.log('node dial err:', err)
	    }
    })
}

function normalizeContent1(content) {
    // console.log(content)
    if (isStream.readable(content.content)) {
        content = { path: content.path, content: toPull.source(content.content) }
        // content.content = toPull.source(content) 
        return content;
    }
}

// function prepareFile(file, opts, self, callback) {
//     opts = opts || {}

//     let cid = new CID(file.multihash)

//     if (opts.cidVersion === 1) {
//         cid = cid.toV1()
//     }

//     waterfall([
//         (cb) => opts.onlyHash
//             ? cb(null, file)
//             : self.object.get(file.multihash, Object.assign({}, opts, { preload: false }), cb),
//         (node, cb) => {
//             const b58Hash = cid.toBaseEncodedString()

//             let size = node.size

//             if (Buffer.isBuffer(node)) {
//                 size = node.length
//             }

//             cb(null, {
//                 path: opts.wrapWithDirectory
//                     ? file.path.substring(WRAPPER.length)
//                     : (file.path || b58Hash),
//                 hash: b58Hash,
//                 size
//             })
//         }
//     ], callback)
// }


// function preloadFile(file, self, opts) {
//     // const isRootFile = opts.wrapWithDirectory
//     //   ? file.path === ''
//     //   : !file.path.includes('/')

//     const isRootFile = (file.path === '')

//     const shouldPreload = isRootFile && !opts.onlyHash && opts.preload !== false

//     if (shouldPreload) {
//         self._preload(file.hash)
//     }

//     return file
// }

function normalizeMultihash(multihash, enc) {
    if (typeof multihash === 'string') {
        if (enc === 'base58' || !enc) {
            return multihash
        }

        return Buffer.from(multihash, enc)
    } else if (Buffer.isBuffer(multihash)) {
        return multihash
    } else if (CID.isCID(multihash)) {
        return multihash.buffer
    } else {
        throw new Error('unsupported multihash')
    }
}


// createNode(dialAddr, (err, node) => {
//     if(err) {
//         console.log('err', err)
//     }

//     printAddrs(node)
//     discovery(node)
// })
const importer = require('ipfs-unixfs-importer')
const values = require('pull-stream/sources/values')
const collect = require('pull-stream/sinks/collect')
const isStream = require('is-stream')
const toPull = require('stream-to-pull-stream')
const BlockService = require('ipfs-block-service')
const Ipld = require('ipld')
const IPFSRepo = require('ipfs-repo')
const Bitswap = require('./Sr')
//const object = require('./object')

//const _repo = new IPFSRepo("E:/wokeplace/nodejs/demo/a/.jsipfs")
const _repo = new IPFSRepo("./.jsipfs")
const _blockService = new BlockService(_repo)
const _ipld = new Ipld({ blockService: _blockService })

var _libp2p
var _bitswap

series([
    (cb) => {
        _repo.init({ my: 'config' }, cb)
    },
    (cb) => {
        _repo.open(cb)
    },
    (cb) => {
        createNode(dialAddr, (err, node) => {
            if (err) {
                console.log('err', err)
            }
            console.log('libp2p start')
            _libp2p = node
            let options = {}
            _bitswap = new Bitswap(_libp2p, _repo.blocks, options)
            _bitswap.start(cb)
	    discovery(_libp2p)
        })
    },
/*
    (cb) => {

        var peer = '/ip4/10.197.163.4/tcp/4002/ipfs/Qmepxu6S132MZyCsz5kwV5rERrRWccVmK5swXkGGjaMRsj'
        // var peer = '/ip4/10.197.176.238/tcp/4002/ipfs/QmaZzbbBKv3u29KNriWY1CT6tm8Ts8yJcJzemJ5vKJFmMW'
        var hash = 'QmYiKrLiZcy2Vug1A3MvuDUhZpTNsnBhQV7pBgh6WrUxD7'
        let mh, cid
        var options = options || {}
        try {
            mh = normalizeMultihash(hash, options.enc)
        } catch (err) {
            return setImmediate(() => console.log('ERR_INVALID_MULTIHASH'))
        }
        // console.log('mh:', mh)
        try {
            cid = new CID(mh)
        } catch (err) {
            return setImmediate(() => console.log('ERR_INVALID_CID'))
        }

        let cids = []
        waterfall([
            (cb) => {
                _ipld.get(cid, (err, value) => {
                    if (err) {
                        console.log(err)
                    }

                    // console.log('result:', value.value._links)  
                    cids = value.value._links
                    // console.log('xxxxx cids:', cids)
                    cb(null, cids)
                })
            },
            (cids, cb) => {
                // console.log('cid[0]:', cids[0])
                // console.log('cid[0].multihash:', cids[0]._cid.multihash)
                // _repo.blocks.get(new CID(cids[0]._cid.multihash), (err, value) => {
                //     if (err) {
                //         console.log(err)
                //     }

                //     console.log('result:', value)
                // })
                cids = cids.map((cid) => {
                    return new CID(cid._cid.multihash)
                })
                // console.log('cids:', cids)
                return cb(null, cids)
            },
            (cids, cb) => {
                var i = 0;
                var blockList = []
                cids.map((cid) => {
                    console.log('xxxxxxxxx')
                    _repo.blocks.get(cid, (err, value) => {
                        if (err) {
                            console.log(err)
                        }

                        i++;
                        // console.log('result:', value)
                        blockList.push(value)
                        if (i === cids.length) {
                            cb(null, blockList)
                        }
                    })
                })

                // Ripd._bitswap._sendMessage(peer, blockList)
            },
            (blockList, cb) => {
                _bitswap._sendMessage(peer, blockList)
            }
        ])

    } */
])
