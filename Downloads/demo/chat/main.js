#!/usr/bin/env node

"use strict"

const isNode = require("detect-node");
if (!isNode) {
    console.log("Env error, try to exec script in node.js");
    return;
}

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

// for realtime aspect, note that push to a pull-stream will loose back pressure.
const transProc = "/msg/1.0.0";
const rsaBits = 2048;
//server where listener launched on.
//TODO dialer get listener IP from config file,
//or listener send IP to dialer while they are connected in intranet.
const listenerServer = "10.197.163.2";
//IP of relay server must be constant.
const relayerServer = "47.97.188.238";

//node configuration, port specified, use random port when change to 0.
const dialAddr = ["/ip4/0.0.0.0/tcp/4001", "/ip4/127.0.0.1/tcp/4002/ws"];
const listenAddr = ["/ip4/0.0.0.0/tcp/4003", "/ip4/127.0.0.1/tcp/4004/ws"];
const relayAddr = ["/ip4/0.0.0.0/tcp/8005", "/ip4/127.0.0.1/tcp/8006/ws"];
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
            node.start(cb);
        }
    ], (err) => callback(err, node));
}

/*
 * verify the existence of peer-id-dialer/listener.json
 * create config file and write to json if not exist.
 */
function nodeInit(target, callback) {
    if (target !== "dialer" && target !== "listener" && target !== "relayer") {
        throw "Failed to init node, target must be dialer/listener/relayer";
    }

    var identity;
    const filePath = `./peer-id-${target}.json`;
    waterfall([
        //verify existence of config file.
        (cb) => {
            fs.exists(filePath, (exists) => {
                if (exists === true) {
                    log(`${filePath} already exists`);
                    identity = JSON.parse(fs.readFileSync(filePath));
                    return callback(identity);
                }

                //generate peer identity keypair.
                log(`generating ${rsaBits}-bit RSA keypair...`);
                PeerId.create({ bits: rsaBits }, cb);

            });
        },
        (peerId, cb) => {
            identity = {
                id: peerId.toB58String(),
                pubKey: peerId.pubKey.bytes.toString("base64"),
                privKey: peerId.privKey.bytes.toString("base64")
            }
            log(`peer identity generated: ${identity.id}`);

            fs.writeFileSync(filePath, JSON.stringify(identity), (err) => {
                if (err) {
                    throw err;
                }
                log(`Success to create ${filePath}`);
            });
            return callback(identity);
        },
    ], (err) => {
        if (err) {
            throw err;
        }
    });
}

/*
 * use specified id to create peerinfo of both dialer and listener.
 * dialer node is always local, listener presents a server node.
 */
function createDialerNode() {
    nodeInit("dialer", (dialObj) => {
        log(dialObj);
        parallel([
            (cb) => {
                PeerId.createFromJSON(dialObj, (err, idDialer) => {
                    if (err) {
                        throw err;
                    };
                    cb(null, idDialer);
                });
            },
            (cb) => {
                const filePath = "./peer-id-listener.json";
                fs.exists(filePath, (exists) => {
                    if (exists === false) {
                        throw `${filePath} does not exist!`;
                    }
                    PeerId.createFromJSON(JSON.parse(fs.readFileSync(filePath)),
                        (err, idListener) => {
                            if (err) {
                                throw err;
                            }
                            cb(null, idListener);
                        });
                });
            },
            (cb) => {
                const filePath = "./peer-id-relayer.json";
                fs.exists(filePath, (exists) => {
                    if (exists === false) {
                        throw `${filePath} does not exist!`;
                    }
                    PeerId.createFromJSON(JSON.parse(fs.readFileSync(filePath)),
                        (err, idRelayer) => {
                            if (err) {
                                throw err;
                            }
                            cb(null, idRelayer);
                        });
                });
            }
        ], (err, ids) => {
            if (err) {
                throw err;
            }
            let idDialer = ids[0];
            let idListener = ids[1];
            let idRelayer = ids[2];

            const peerDialer = new PeerInfo(idDialer);
            dialAddr.forEach((addr) => peerDialer.multiaddrs.add(addr));
            const nodeDialer = new Node({ peerInfo: peerDialer });
            const peerListener = new PeerInfo(idListener);

            //XXX The multiaddrs we add here depends the location of the listener.
            //If the listener launched on a server, we need to get the server's IP address before.
            //Specially, "/ip4/0.0.0.0/tcp/4003" means the listener is at local.
            peerListener.multiaddrs.add(`/ip4/${listenerServer}/tcp/4003`);

            const peerRelayer = new PeerInfo(idRelayer);
            peerRelayer.multiaddrs.add(`/ip4/${relayerServer}/tcp/8005`);

            const ipaddr = ip.address();
            nodeDialer.start((err) => {
                if (err) {
                    throw err;
                }
                printAddrs(nodeDialer);
                console.log(`Dialer node [${idDialer.toB58String()}] ready.`);

                //discovery is not needed if we use pull-stream to send data.
                //discovery(nodeDialer);

                let before = process.uptime() * 1000;
                nodeDialer.dial(peerRelayer, (err) => {
                    let afterRelay = process.uptime() * 1000;
                    if (err) {
                        console.log("Failed to connect relay node, intranet mode only!");
                    }

                    nodeDialer.dialProtocol(peerListener, transProc, (err, conn) => {
                        let afterListen = process.uptime() * 1000;
                        console.log("dial relay interval: ", afterRelay - before);
                        console.log("dial listen interval: ", afterListen - afterRelay);
                        if (err) {
                            throw err;
                        }
                        console.log(`Success to dial node [${idListener.toB58String()}].`);
                        log(`Dialing on protocol: ${transProc}`);
                        console.log("Type a message, enter to send:")

                        // for realtime aspect, note that push to a pull-stream
                        // will loose back pressure
                        const source = Pushable();
                        // write operation. Data sent as a buffer
                        pull(source, conn);
                        // sink, data converted from buffer to utf8 string
                        pull(conn, pull.map((data) => {
                            return data.toString("utf8").replace("\n", "");
                        }), pull.drain(console.log));

                        process.stdin.setEncoding("utf8");
                        // resume stdin and listen on data event
                        process.openStdin().on("data", (chunk) => {
                            source.push(`[${ipaddr}]: ${chunk.toString()}`);
                        });

                    });
                });
            });
        });
    });
}

/*
 * use specified id to create peerinfo of listener.
 * listener presents a server node, create it before dialer.
 */
function createListenerNode() {
    nodeInit("listener", (listenObj) => {
        log(listenObj);
        parallel([
            (cb) => {
                PeerId.createFromJSON(listenObj, (err, idListener) => {
                    if (err) {
                        throw err;
                    }
                    cb(null, idListener);
                });
            },
            (cb) => {
                const filePath = "./peer-id-relayer.json";
                fs.exists(filePath, (exists) => {
                    if (exists === false) {
                        throw `${filePath} does not exist!`;
                    }
                    PeerId.createFromJSON(JSON.parse(fs.readFileSync(filePath)),
                        (err, idRelayer) => {
                            if (err) {
                                throw err;
                            }
                            cb(null, idRelayer);
                        });
                });
            }
        ], (err, ids) => {
            if (err) {
                throw err;
            }
            let idListener = ids[0];
            let idRelayer = ids[1];

            const peerListener = new PeerInfo(idListener);
            listenAddr.forEach((addr) => peerListener.multiaddrs.add(addr));
            const nodeListener = new Node({ peerInfo: peerListener });

            const peerRelayer = new PeerInfo(idRelayer);
            peerRelayer.multiaddrs.add(`/ip4/${relayerServer}/tcp/8005`);

            const ipaddr = ip.address();
            nodeListener.start((err) => {
                if (err) {
                    throw err;
                }
                printAddrs(nodeListener);
                console.log(`Listener node [${idListener.toB58String()}] ready.`);

                //find and dial online peers, this is useful while dialer and listener
                //located in different intranets. Note that relay will only work if it
                //already has a connection to the listener node.
                discovery(nodeListener);

                nodeListener.dial(peerRelayer, (err) => {
                    if (err) {
                        console.log("Failed to connect relay node, intranet mode only!");
                    }
                });

                nodeListener.handle(transProc, (protocol, conn) => {
                    console.log("*** Connection established. ***");
                    const source = Pushable();
                    pull(source, conn);

                    pull(conn,
                        pull.map((data) => {
                            return data.toString("utf8").replace("\n", "")
                        }),
                        pull.drain(console.log, () => {
                            source.end();
                            console.log("*** Connection closed! ***");
                        })
                    );

                    process.stdin.setEncoding("utf8");
                    process.openStdin().on("data", (chunk) => {
                        source.push(`[${ipaddr}]: ${chunk.toString()}`);
                    });
                });
            });
        });
    });
}

/*
 * use specified id to create peerinfo of relayer.
 * relayer must be create before listener.
 */
function createRelayNode() {
    nodeInit("relayer", (relayObj) => {
        log(relayObj);
        PeerId.createFromJSON(relayObj, (err, idRelayer) => {
            if (err) {
                throw err;
            }
            const peerRelayer = new PeerInfo(idRelayer);
            relayAddr.forEach((addr) => peerRelayer.multiaddrs.add(addr));
            const nodeRelayer = new Node({ peerInfo: peerRelayer });

            nodeRelayer.start((err) => {
                if (err) {
                    throw err;
                }
                printAddrs(nodeRelayer);

                nodeRelayer.on("peer:connect", (peerInfo) => {
                    log("Connection established to node: %s", peerInfo.id.toB58String());
                });
                nodeRelayer.on("peer:disconnect", (peerInfo) => {
                    log("Connection closed to node: %s", peerInfo.id.toB58String());
                });

                console.log(`Relayer node [${idRelayer.toB58String()}] ready.`);
            });
        });
    });
}

/* print all multiaddr of peerinfo */
function printAddrs(nodes) {
    if (!Array.isArray(nodes)) {
        nodes = [nodes];
    }
    nodes.forEach((node) => {
        log("Creating node %s, multiaddrs:", node.peerInfo.id.toB58String());
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
}

/*
 * Query the DHT for all multiaddresses associated with a `PeerId`.
 * peerId = node.peerInfo.id, the query peer.
 */
function peerRouting(node, peerId) {
    if (typeof peerId === "string") {
        peerId = PeerId.createFromB58String(peerId);
    }
    node.peerRouting.findPeer(peerId, (err, peer) => {
        if (err) {
            throw err;
        }

        console.log("Found peer, multiaddrs are:");
        peer.multiaddrs.forEach((ma) => console.log("\t" + ma.toString()));
    });
}

/*
 * Find the closest peers to a given `PeerId`, by querying the DHT.
 * peerId = node.peerInfo.id, the query peer.
 */
function peerRoutingClosest(node, peerId, callback) {
    if (typeof peerId === "string") {
        peerId = PeerId.createFromB58String(peerId);
    }

    node._dht.getClosestPeers(peerId.toBytes(), (err, peerIds) => {
        if (err) {
            return callback(err);
        }
        callback(null, peerIds.map((id) => {
            return { ID: id.toB58String() };
        }))
    });
}

/*
 * Find peers in the DHT that can provide a specific value, given a key.
 * cid: the key to find providers for.
 * timeout: 5000?
 */
function findprovs(node, cid, timeout) {
    node.contentRouting.findProviders(cid, timeout, (err, providers) => {
        if (err) {
            throw err;
        }

        console.log("Found provider:", providers[0].id.toB58String());
    });
}

/********************************test interface********************************/
function discoveryTest() {
    createNode(dialAddr, (err, dialNode) => {
        if (err) {
            throw err;
        }
        printAddrs(dialNode);
        discovery(dialNode);
    });
}

function peerRoutingTest() {
    parallel([
        (cb) => createNode(dialAddr, cb),
        (cb) => createNode(listenAddr, cb),
    ], (err, nodes) => {
        if (err) {
            throw err;
        }
        printAddrs(nodes);
        const dialNode = nodes[0];
        const listenNode = nodes[1];

        dialNode.dial(listenNode.peerInfo, () => { });
        setTimeout(() => {
            peerRouting(dialNode, listenNode.peerInfo.id);
        }, 1000);
    });
}

function contentRoutingTest() {
    parallel([
        (cb) => createNode(dialAddr, cb),
        (cb) => createNode(listenAddr, cb),
        (cb) => createNode("/ip4/0.0.0.0/tcp/8008", cb),
    ], (err, nodes) => {
        if (err) {
            throw err;
        }
        printAddrs(nodes);
        const dialNode = nodes[0];
        const listenNode = nodes[1];
        const threeNode = nodes[2];

        parallel([
            (cb) => dialNode.dial(listenNode.peerInfo, cb),
            (cb) => listenNode.dial(threeNode.peerInfo, cb),
            // Set up of the cons might take time
            (cb) => setTimeout(cb, 300)
        ], (err) => {
            if (err) {
                throw err;
            }
            const cid = new CID("QmTp9VkYvnHyrqKQuFPiuZkiX9gPcqj6x5LJ1rmWuSySnL");

            //Announce to the network that we are providing given values.
            //keys: the keys that should be announced
            dialNode.contentRouting.provide(cid, (err) => {
                if (err) {
                    throw err;
                }

                let peerIdString = dialNode.peerInfo.id.toB58String();
                let cidString = cid.toBaseEncodedString();
                console.log(`Node ${peerIdString} is providing ${cidString}`);
                findprovs(threeNode, cid, 5000);
            });
        });
    });
}

/********************************main start********************************/
let args = process.argv.splice(2);
if (args.length) {
    log(`Input argument: ${args}`);
}

switch (args[0]) {
    case "discovery":
        discoveryTest();
        break;
    case "peerRouting":
        peerRoutingTest();
        break;
    case "contentRouting":
        contentRoutingTest();
        break;
    case "newDialer":
        createDialerNode();
        break;
    case "newListener":
        createListenerNode();
        break;
    case "newRelayer":
        createRelayNode();
        break;
    default:
        console.log("Unknown argument!");
        break;
}
