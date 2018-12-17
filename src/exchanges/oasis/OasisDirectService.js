import PrivateService from '../../core/PrivateService';
import { getCurrency } from '../../eth/Currency';
import contracts from '../../../contracts/contracts';
import { contractInfo } from '../../../contracts/networks';

export default class OasisDirectService extends PrivateService {
  constructor(name = 'exchange') {
    super(name, ['proxy', 'smartContract', 'token', 'cdp', 'web3']);
  }

  _oasisDirect() {
    return this.get('smartContract').getContractByName(contracts.OASIS_PROXY);
  }

  async _checkProxy() {
    // Add optional callback for build here
    return this.get('proxy').currentProxy()
      ? true
      : await this.get('proxy').build();
  }

  _setTradeState(operation, payToken, buyToken, amount) {
    this._operation = operation;
    this._payToken = payToken;
    this._buyToken = buyToken;
    this._value = amount;
  }

  _setEthTradeState(operation, token, value) {
    this._operation = operation;
    this._payToken = token;
    this._value = value;
    this._buyToken = 'WETH';
  }

  _trade() {
    const params = this._buildTradeParams();
    return this._oasisDirect()[this._operation](...params, { dsProxy: true });
  }

  async getBuyAmount() {
    const otc = this.get('smartContract').getContractByName(
      contracts.MAKER_OTC
    );
    return await otc.getBuyAmount(
      this._getContractAddress(this._buyToken),
      this._getContractAddress(this._payToken),
      this._valueForContract(this._value, this._buyToken)
    );
  }

  async getPayAmount() {
    const otc = this.get('smartContract').getContractByName(
      contracts.MAKER_OTC
    );
    return await otc.getPayAmount(
      this._getContractAddress(this._buyToken),
      this._getContractAddress(this._payToken),
      this._valueForContract(this._value, this._payToken)
    );
  }

  _buildTradeParams() {
    return [
      this._getContractAddress('MAKER_OTC'),
      this._getContractAddress(this._payToken),
      this._valueForContract(this._value, this._payToken),
      this._getContractAddress(this._buyToken),
      this._limit()
    ];
  }

  _threshold() {
    if (
      (this._payToken === 'DAI' && this._buyToken === 'ETH') ||
      (this._payToken === 'ETH' && this._buyToken === 'DAI')
    ) {
      return 2;
    } else {
      return 1;
    }
  }

  async _limit() {
    // The results don't look right for sellAll...
    if (this._operation.includes('sellAll')) {
      const buyAmount = await this.getBuyAmount();
      return this._valueForContract(buyAmount * (1 - this._threshold()), 'eth');
    } else {
      const payAmount = await this.getPayAmount();
      return this._valueForContract(
        (payAmount * (1 + this._threshold())).round(0),
        'eth'
      );
    }
  }

  _valueForContract(amount, symbol) {
    return getCurrency(amount, symbol).toEthersBigNumber('wei');
  }

  async getBalance(token) {
    return await this.get('token')
      .getToken(token)
      .balanceOf(
        this.get('smartContract')
          .get('web3')
          .currentAccount()
      );
  }

  _getContractAddress(name) {
    switch (name) {
      case 'MKR':
        return this._contractInfo().MKR[1].address;
      case 'WETH':
        return this._contractInfo().WETH[0].address;
      case 'PETH':
        return this._contractInfo().PETH[0].address;
      case 'DAI':
        return this._contractInfo().DAI[0].address;
      case 'MAKER_OTC':
        return this._contractInfo().MAKER_OTC[0].address;
    }
  }

  _contractInfo() {
    return contractInfo(this.get('proxy')._network());
  }

  sellAllAmountPayEth(token, amount, options) {
    return this._oasisDirect().sellAllAmountPayEth(
      this._getContractAddress('MAKER_OTC'),
      this._getContractAddress('WETH'),
      this._getContractAddress(token),
      this._valueForContract(amount, 'eth'),
      {
        value: options.value,
        dsProxy: true
      }
    );
  }

  buyAllAmountPayEth(token, amount) {
    return this._oasisDirect().buyAllAmountPayEth(
      this._getContractAddress('MAKER_OTC'),
      this._getContractAddress(token),
      this._getContractAddress('WETH'),
      this._valueForContract(amount, token),
      { dsProxy: true }
    );
  }
}

const tradeOps = [
  'sellAllAmount',
  'sellAllAmountBuyEth',
  'buyAllAmount',
  'buyAllAmountBuyEth'
];

Object.assign(
  OasisDirectService.prototype,
  tradeOps.reduce((exchange, name) => {
    exchange[name] = async function(...args) {
      await this._checkProxy();
      name.includes('Eth')
        ? this._setEthTradeState(name, ...args)
        : this._setTradeState(name, ...args);
      return this._trade();
    };
    return exchange;
  }, {})
);