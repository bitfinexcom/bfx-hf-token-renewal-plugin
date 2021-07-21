'use strict'

const debug = require('debug')('token:renew:plugin')
const Try = require('flat-try')

const THRESHOLD = 60 * 60 * 1000 // renew one hour before expiring

class TokenRenewalPlugin {
  /**
   * @param {Object} adapter
   * @param {function: Promise<{ authToken: string, expiresAt: number }>} adapter.refreshToken
   */
  constructor (adapter) {
    this.id = 'renew-token-plugin'
    this.type = 'ws2'
    this.manager = {
      'ws:created': this._onCreate.bind(this),
      'ws:destroyed': this._onClose.bind(this)
    }
    this.algoManagers = new Map()
    this.adapter = adapter

    this._renewAuthToken = this._renewAuthToken.bind(this)
  }

  close () {
    this._clearTimeout()
    this.algoManagers.clear()
  }

  _onCreate (args = {}) {
    const { id, manager, state = {} } = args
    this.algoManagers.set(id, new WeakRef(manager))

    if (!this._timeout) {
      this._scheduleAutoRenewal()
    }

    return state
  }

  _onClose ({ id, state = {} } = {}) {
    this.algoManagers.delete(id)

    if (this.algoManagers.size === 0) {
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

      for (const manager of this._getManagersAndCleanReclaimedRefs()) {
        manager.emit('plugin:error', `[${this.id}] error: ${err.message}`)
      }

      this._scheduleAutoRenewal()
      return
    }

    const { authToken, expiresAt } = response

    for (const manager of this._getManagersAndCleanReclaimedRefs()) {
      manager.auth({ authToken })
    }

    this._scheduleAutoRenewal(expiresAt)
  }

  _getManagersAndCleanReclaimedRefs () {
    const managers = []

    for (const [id, ref] of this.algoManagers.entries()) {
      const manager = ref.deref()

      if (!manager) {
        this.algoManagers.delete(id)
        continue
      }

      managers.push(manager)
    }

    return managers
  }

  _clearTimeout () {
    if (!this._timeout) return
    clearTimeout(this._timeout)
    this._timeout = undefined
  }
}

module.exports = TokenRenewalPlugin
