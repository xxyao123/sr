const DecisionEngine = require('./DecisionEngine')
const Network = require('./network')

const waterfall = require('async/waterfall')
const each = require('async/each')
const map = require('async/map')
const series = require('async/series')

const defaultOptions = {
    statsEnabled: false,
    statsComputeThrottleTimeout: 1000,
    statsComputeThrottleMaxQueueSize: 1000
}

class sr {
    constructor(libp2p, blockstore, repo, options) {
        this._libp2p = libp2p
        this.blockstore = blockstore
        this._options = Object.assign({}, defaultOptions, options)
        this._repo = repo
        // stats
        // this._stats = new Stats(statsKeys, {
        //     enabled: this._options.statsEnabled,
        //     computeThrottleTimeout: this._options.statsComputeThrottleTimeout,
        //     computeThrottleMaxQueueSize: this._options.statsComputeThrottleMaxQueueSize
        // })
        this._stats = null
        this.network = new Network(libp2p, this, {}, this._stats)
        this.engine = new DecisionEngine(blockstore, this.network, this._stats)
    }

    _receiveMessage(peerId, incoming, callback) {
        this.engine.messageReceived(peerId, incoming, (err) => {
            if (err) {
                console.log('failed to receive message')
            }

            if (incoming.blocks.size === 0) {
                return callback()
            }

            const blocks = Array.from(incoming.blocks.values())

            each(
                blocks,
                (b, cb) => this._handleReceivedBlock(peerId, b, cb),
                callback
            )
        })
    }

    _handleReceivedBlock(peerId, blocks, callback) {
        console.log('receive block')

        waterfall([
            (cb) => this.blockstore.has(block.cid, cb),
            (has, cb) => {
                if (has) {
                    return cb()
                }
                this._putBlock(block, cb)
            }
        ], callback)
    }

    _putBlock(block, callback) {
        this.blockstore.put(block, (err) => {
            if (err) {
                return callback(err)
            }

            // this.network.provide(block.cid, (err) => {
            //     if(err) {
            //         console.log('Failed to provide:%s', err.message)
            //     }

            //     this.engine.receivedBlocks([block.cid])
            //     callback()
            // })
        })
    }


    _sendMessage(peer, blockList) {
        // const blockList = cids.map((cid) => {
        //     return find(blocks, (b) => b.cid.equals(cid))

        // console.log('_sendMessage cids:', cids)

        // waterfall([
        //     (cb) => {
        //         const blockList = cids.map((cid) => {
        //             console.log('xxxxxxxxx')
        //             this.blockstore.get(cid, (err, value) => {
        //                 if (err) {
        //                     console.log(err)
        //                 }

        //                 console.log('result:', value)
        //                 return value
        //             })
        //         })
        //         cb(null, blockList)
        //     },
            // (blockList, cb) => {
                // console.log('blocklist:', blockList)
                this.engine._sendBlocks(peer, blockList, (err) => {
                    if (err) {
                        // `_sendBlocks` actually doesn't return any errors
                        this._log.error('should never happen: ', err)
                    } else {
                        //   blockList.forEach((block) => this.engine.messageSent(peer, block))
                    }
                })
            // }
        // ])
    }

    // handle errors on the receiving channel
    _receiveError(err) {
        // this._log.error('ReceiveError: %s', err.message)
        console.log('ReceiveError: %s', err.message)
    }

    // handle new peers
    _onPeerConnected(peerId) {
        // this.wm.connected(peerId)
        console.log('peer connected:', peerId)
    }

    // handle peers being disconnected
    _onPeerDisconnected(peerId) {
        // this.wm.disconnected(peerId)
        this.engine.peerDisconnected(peerId)
        // this._stats.disconnected(peerId)
    }

    /**
   * Start the bitswap node.
   *
   * @param {function(Error)} callback
   *
   * @returns {void}
   */
    start(callback) {
        series([
            //   (cb) => this.wm.start(cb),
            (cb) => this.network.start(cb),
            (cb) => this.engine.start(cb)
        ], callback)
    }

    /**
     * Stop the bitswap node.
     *
     * @param {function(Error)} callback
     *
     * @returns {void}
     */
    stop(callback) {
        this._stats.stop()
        series([
            //   (cb) => this.wm.stop(cb),
            (cb) => this.network.stop(cb),
            (cb) => this.engine.stop(cb)
        ], callback)
    }
}

exports = module.exports = sr