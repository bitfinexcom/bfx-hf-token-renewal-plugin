'use strict'

const { RESTv2 } = require('bfx-api-node-rest')

const DEFAULT_URL = 'https://api.bitfinex.com'
const DEFAULT_TTL = 60 * 60 * 24
const DEFAULT_CAPS = ['a', 'o', 'w']

class BitfinexAdapter {
  /**
   * @param {Object}    args
   * @param {string}    args.apiKey
   * @param {string}    args.apiSecret
   * @param {string?}   args.url - API URL
   * @param {number?}   args.ttl - token TTL in seconds
   * @param {string[]?} args.caps - token caps/permissions, available values: [a, o, f, s, w, wd]
   * @param {boolean?}  args.writePermission - token write permission for the caps, default: true
   */
  constructor (args) {
    const {
      url = DEFAULT_URL,
      ttl = DEFAULT_TTL,
      caps = DEFAULT_CAPS,
      writePermission = true,
      apiKey,
      apiSecret
    } = args

    this._generateOptions = {
      scope: 'api',
      writePermission,
      ttl,
      caps
    }

    this.rest = new RESTv2({
      url,
      apiKey,
      apiSecret,
      transform: true
    })
  }

  /**
   * @returns {Promise<{authToken: string, expiresAt: number}>}
   */
  async refreshToken () {
    try {
      const [authToken] = await this.rest.generateToken(this._generateOptions)
      const expiresAt = Date.now() + (this._generateOptions.ttl * 1000)

      return { authToken, expiresAt }
    } catch (e) {
      if (e.message.includes("ERR_TOKEN_CAPS_POLICY_INVALID")) {
        throw new Error('The given API key does not have the required permissions, please make sure to enable "get" and "create" capacities for "Account", "Orders", and "Wallets"')
      }

      throw e
    }
  }
}

module.exports = BitfinexAdapter
