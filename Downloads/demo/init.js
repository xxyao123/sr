const defaultsDeep = require('@nodeutils/defaults-deep')
const defaultConfig = require('./config-nodejs')
const waterfall = require('async/waterfall')
const RIPD = require('./test_class')
const peerId = require('peer-id')
const Ripd = new RIPD()

const config = defaultsDeep(Ripd._options.config, defaultConfig())
var opts = {}

opts.emptyRepo = opts.emptyRepo || false
opts.bits = Number(opts.bits) || 2048

const done = (err, res) => {
    if (err) {
        // Ripd.emit('error', err)
        console.log('done', err)
        return
        //   return callback(err)
    }
    Ripd.preStart((err) => {

        if (err) {
            // self.emit('error', err)
            console.log(err)
            return
        }
            // return callback(err)

        //   Ripd.state.initialized()
        //   Ripd.emit('init')
        console.log(res)
        //   callback(null, res)
    })
}
let privateKey


waterfall([
    (cb) => Ripd._repo.exists(cb),
    (exists, cb) => {
        console.log('exists:', exists)     
        if (exists === true) {
            return cb(new Error('repo already exists'))
        }

        if (opts.privateKey) {
            if (typeof opts.privateKey === 'object') {
                cb(null, opts.privateKey)
            } else {
                peerId.createFromPrivKey(Buffer.from(opts.privateKey, 'base64'), cb)
            }
        } else {
            console.log(`generating ${opts.bits}-bit RSA keypair...`)
            peerId.create({ bits: opts.bits }, cb)
        }
    },

    (peerId, cb) => {       
        console.log('peerId:' + peerId)
        config.Identity = {
            PeerID: peerId.toB58String(),
            PrivKey: peerId.privKey.bytes.toString('base64')
        }
        privateKey = peerId.privKey
        console.log('peer privateKey: ' + privateKey)
        console.log('peer identity: ' + config.Identity.PeerID)
        Ripd._repo.init(config, cb)
    },
    (_, cb) => {
        console.log('open 1111')
        Ripd._repo.open(cb)
    },
    // (cb) => {
    //     cb(null, true)
    // },
    // (_, cb) => {
    //     if(opts.emptyRepo) {
    //         return cb(null, true)
    //     }
    // }

], done)

