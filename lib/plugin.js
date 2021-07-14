'use strict'

const debug = require('debug')('token:renew:plugin')
const Try = require('flat-try')

const THRESHOLD = 60 * 60 * 1000 // renew one hour before expiring

class TokenRenewalPlugin {
  constructor (adapter) {
    this.id = 'renew-token-plugin'
    this.type = 'ws2'
    this.manager = {
      'ws:created': this._onCreate.bind(this),
      'ws:destroyed': this._onClose.bind(this)
    }
    this._algoManagers = new Map()
    this.adapter = adapter

    this._renewAuthToken = this._renewAuthToken.bind(this)
  }

  _onCreate (args = {}) {
    const { id, manager, state = {} } = args
    this._algoManagers.set(id, new WeakRef(manager))

    if (!this._timeout) {
      this._scheduleAutoRenewal()
    }

    return state
  }

  _onClose ({ id, state = {} } = {}) {
    this._algoManagers.delete(id)

    if (this._algoManagers.size === 0) {
      this._clearTimeout()
    }

    return state
  }

  _scheduleAutoRenewal (expiresAt = 0) {
    const timeout = expiresAt - Date.now() - THRESHOLD
    this._timeout = setTimeout(this._renewAuthToken, timeout)
  }

  async _renewAuthToken () {
    this._clearTimeout()

    const [err, response] = await Try.promise(() => this.adapter.refreshToken())

    if (err) {
      debug('failed to renew auth token: %j', err)

      for (const manager of this._getManagers()) {
        manager.emit('plugin:error', `[${this.id}] error: ${err.message}`)
      }

      this._scheduleAutoRenewal()
      return
    }

    const { authToken, expiresAt } = response

    for (const manager of this._getManagers()) {
      manager.auth({ authToken })
    }

    this._scheduleAutoRenewal(expiresAt)
  }

  * _getManagers () {
    for (const [id, ref] of this._algoManagers.entries()) {
      const manager = ref.deref()

      if (!manager) {
        this._algoManagers.delete(id)
        continue
      }

      yield manager
    }
  }

  _clearTimeout () {
    if (!this._timeout) return
    clearTimeout(this._timeout)
    this._timeout = undefined
  }
}

module.exports = TokenRenewalPlugin
