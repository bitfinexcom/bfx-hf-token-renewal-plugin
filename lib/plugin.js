'use strict'

const debug = require('debug')('token:renew:plugin')
const Try = require('flat-try')

const THRESHOLD = 60 * 60 * 1000 // renew one hour before expiring
const defaultRetryInterval = 30 * 1000
const defaultMaxRetries = 3

/**
 * @typedef {Object} Adapter
 * @property {function(): Promise<{ authToken: string, expiresAt: number }>} refreshToken
 */

class TokenRenewalPlugin {
  /**
   * @param {Adapter} adapter
   * @param {Object} config
   * @param {number?} config.maxRetries - default 3
   * @param {number?} config.retryInterval - 30 seconds
   */
  constructor (adapter, config = {}) {
    this.id = 'renew-token-plugin'
    this.type = 'ws2'
    this.manager = {
      'ws:created': this._onCreate.bind(this),
      'ws:destroyed': this._onClose.bind(this)
    }
    this.algoManagers = new Map()
    this.adapter = adapter

    const {
      maxRetries = defaultMaxRetries,
      retryInterval = defaultRetryInterval
    } = config

    this.retries = 0
    this.maxRetries = maxRetries
    this.retryInterval = retryInterval

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

  _scheduleAutoRenewal (timeout = 0) {
    this._timeout = setTimeout(this._renewAuthToken, timeout)
  }

  async _renewAuthToken () {
    this._clearTimeout()

    const [err, response] = await Try.promise(() => this.adapter.refreshToken())

    if (err) {
      return this._handleError(err)
    }

    if (this.retries > 0) {
      this.retries = 0
    }

    const { authToken, expiresAt } = response

    for (const manager of this._getManagersAndCleanReclaimedRefs()) {
      manager.auth({ authToken })
    }

    const timeout = expiresAt - Date.now() - THRESHOLD
    this._scheduleAutoRenewal(timeout)
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

  _handleError (err) {
    debug('failed to renew auth token: %j', err)

    this.retries++

    if (this.retries >= this.maxRetries) {
      return this._notifyError(`[${this.id}] error: max retries exceeded`)
    }

    this._notifyError(`[${this.id}] error: ${err.message}`)
    this._scheduleAutoRenewal(this.retryInterval)
  }

  _notifyError (message) {
    for (const manager of this._getManagersAndCleanReclaimedRefs()) {
      manager.emit('plugin:error', message)
    }
  }
}

module.exports = TokenRenewalPlugin
