/* eslint-env mocha */
/* eslint-disable no-unused-expressions */
'use strict'

const { expect } = require('chai')
const { createSandbox, assert } = require('sinon')
const proxyquire = require('proxyquire')

const sandbox = createSandbox()
const RestConstructor = sandbox.stub()
const RestStub = {
  generateToken: sandbox.stub()
}

const BitfinexAdapter = proxyquire('../../lib/adapters/bitfinex-adapter', {
  'bfx-api-node-rest': {
    RESTv2: sandbox.spy((args) => {
      RestConstructor(args)
      return RestStub
    })
  }
})

describe('BitfinexAdapter', () => {
  after(() => {
    sandbox.restore()
  })

  const args = {
    url: 'api url',
    apiKey: 'api key',
    apiSecret: 'api secret',
    ttl: 1337,
    caps: ['f'],
    writePermission: false
  }

  it('should call the api and generate a token', async () => {
    const now = 1000
    sandbox.stub(Date, 'now').returns(now)
    const generatedAuthToken = 'generated auth token'
    RestStub.generateToken.resolves([generatedAuthToken])

    const adapter = new BitfinexAdapter(args)
    const { authToken, expiresAt } = await adapter.refreshToken()

    assert.calledWithExactly(RestConstructor, {
      url: args.url,
      apiKey: args.apiKey,
      apiSecret: args.apiSecret,
      transform: true
    })
    assert.calledWithExactly(RestStub.generateToken, {
      scope: 'api',
      writePermission: args.writePermission,
      ttl: args.ttl,
      caps: args.caps
    })
    expect(authToken).to.eq(generatedAuthToken)
    expect(expiresAt).to.eq(1338000)
  })

  it('should handle capacity errors', async () => {
    RestStub.generateToken.rejects(new Error('500 - ["error",null,"ERR_TOKEN_CAPS_POLICY_INVALID"]'))

    const adapter = new BitfinexAdapter(args)

    try {
      await adapter.refreshToken()
      assert.fail()
    } catch (e) {
      expect(e.message).to.eq('the given API key does not have the required permissions, please make sure to enable "get" and "create" capacities for "Account", "Orders", and "Wallets"')
    }
  })
})
