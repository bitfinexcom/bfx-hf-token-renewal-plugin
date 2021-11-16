/* eslint-env mocha */
/* eslint-disable no-unused-expressions */
'use strict'

const { expect } = require('chai')
const { createSandbox, assert } = require('sinon')
const proxyquire = require('proxyquire')

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const sandbox = createSandbox()
const debugStub = sandbox.stub()

const TokenRenewalPlugin = proxyquire('../lib/plugin', {
  debug: () => debugStub
})

describe('RenewTokenPlugin', () => {
  beforeEach(() => {
    sandbox.stub(Date, 'now').returns(0)
  })

  afterEach(() => {
    sandbox.reset()
    sandbox.restore()
  })

  const expiresAt = 24 * 60 * 60 * 1000
  const id = 'id'
  const manager = { authToken: 'auth token' }
  const state = { key: 'value' }
  const adapter = {
    refreshToken: sandbox.stub()
  }

  it('should schedule token renewal', async () => {
    const plugin = new TokenRenewalPlugin(adapter)

    plugin.manager['ws:created']({ id, manager, state })

    assert.notCalled(adapter.refreshToken)
    expect(plugin.id).to.eq('renew-token-plugin')
    expect(plugin.type).to.eq('ws2')
    expect(plugin._timeout).not.to.be.undefined
    plugin.close()
  })

  it('should clean-up after ws:destroyed notification', async () => {
    const plugin = new TokenRenewalPlugin(adapter)

    let nextState = plugin.manager['ws:created']({ id, manager, state })
    expect(plugin._timeout).not.to.be.undefined
    const managerRef = plugin.algoManagers.get(id)
    expect(managerRef).to.be.instanceof(WeakRef)
    expect(managerRef.deref()).to.eql(manager)
    expect(nextState).to.eql(state)

    nextState = plugin.manager['ws:destroyed']({ id, state })
    expect(plugin._timeout).to.be.undefined
    expect(nextState).to.eql(state)

    assert.notCalled(adapter.refreshToken)
    plugin.close()
  })

  it('immediately renew token if expiresAt is not provided', async () => {
    const newToken = {
      authToken: 'new token',
      expiresAt
    }
    const manager = {
      authToken: 'auth token',
      auth: sandbox.stub()
    }
    adapter.refreshToken.resolves(newToken)

    const plugin = new TokenRenewalPlugin(adapter)
    const nextState = plugin.manager['ws:created']({ id, manager, state })
    await delay(100)

    assert.calledWithExactly(manager.auth, { authToken: newToken.authToken })
    assert.calledOnce(adapter.refreshToken)
    assert.calledWithExactly(adapter.refreshToken)
    expect(nextState).to.eql(state)
    expect(plugin._timeout).not.to.be.undefined
    plugin.close()
  })

  it('should handle errors', async () => {
    const fakeErr = new Error('message explaining error')
    adapter.refreshToken.rejects(fakeErr)

    const config = {
      maxRetries: 3,
      retryInterval: 10,
      expiresAt: 100
    }
    const plugin = new TokenRenewalPlugin(adapter, config)
    expect(plugin.expiresAt).to.eq(config.expiresAt)

    const manager = { emit: sandbox.stub() }
    plugin.manager['ws:created']({ id, manager, state })

    await delay(100)
    assert.callCount(adapter.refreshToken, 4)
    assert.calledWithExactly(debugStub, 'failed to renew auth token: %j', fakeErr)
    assert.calledWithExactly(manager.emit, 'plugin:error', '[renew-token-plugin] error: message explaining error')
    assert.calledWithExactly(manager.emit, 'plugin:error', '[renew-token-plugin] error: max retries exceeded')
    expect(plugin._timeout).to.be.undefined
    plugin.close()
  })
})
