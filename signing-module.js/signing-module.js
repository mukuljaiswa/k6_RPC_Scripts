// signing-module.js - Reusable signing module
const { Web3 } = require('web3');
const { HttpProvider } = require('web3-providers-http');

const config = {
  RPC_URL: process.env.RPC_URL || 'https://rpc.loadtest.devdomain123.com/',
  GAS: parseInt(process.env.GAS_LIMIT) || 30000,
  GAS_PRICE: process.env.GAS_PRICE || '50',
  DEFAULT_AMOUNT_ETHER: process.env.DEFAULT_AMOUNT_ETHER || '0.0001'
};

const web3 = new Web3(new HttpProvider(config.RPC_URL));
const nonceTracker = {};

// Helper to get proper nonce
async function getNonce(address) {
  try {
    const blockchainNonce = await web3.eth.getTransactionCount(address, 'pending');
    
    if (nonceTracker[address] === undefined) {
      nonceTracker[address] = BigInt(blockchainNonce);
    } else {
      const trackedNonce = nonceTracker[address];
      if (BigInt(blockchainNonce) > trackedNonce) {
        nonceTracker[address] = BigInt(blockchainNonce);
      }
    }
    
    return nonceTracker[address];
  } catch (error) {
    console.error(`Error getting nonce for ${address}:`, error);
    throw error;
  }
}

// Main signing function
async function signTransaction(receiver, sender, amountEther = config.DEFAULT_AMOUNT_ETHER) {
  try {
    if (!sender?.address || !sender?.privateKey) {
      throw new Error('Invalid sender wallet provided');
    }
    
    if (!receiver) {
      throw new Error('Receiver address required');
    }

    // Validate addresses
    if (!web3.utils.isAddress(sender.address)) {
      throw new Error('Invalid sender address');
    }
    
    const receiverAddress = receiver.address || receiver;
    if (!web3.utils.isAddress(receiverAddress)) {
      throw new Error('Invalid receiver address');
    }

    // Get proper nonce
    const currentNonce = await getNonce(sender.address);
    
    const tx = {
      to: receiverAddress,
      value: web3.utils.toWei(amountEther, 'ether'),
      gas: config.GAS,
      gasPrice: web3.utils.toWei(config.GAS_PRICE, 'gwei'),
      nonce: Number(currentNonce)
    };

    console.log(`Creating transaction for ${sender.address}:`, {
      to: receiverAddress,
      nonce: Number(currentNonce),
      value: amountEther
    });

    const signedTx = await web3.eth.accounts.signTransaction(tx, sender.privateKey);
    
    console.log("Signed Transaction Details:", {
      from: sender.address,
      to: receiverAddress,
      transactionHash: signedTx.transactionHash,
      nonce: Number(currentNonce)
    });

    // Update nonce tracker
    nonceTracker[sender.address] = currentNonce + BigInt(1);
    
    return {
      signedTx: signedTx.rawTransaction,
      nonce: Number(currentNonce).toString(),
      transactionHash: signedTx.transactionHash
    };
    
  } catch (err) {
    console.error("Signing Error:", err);
    throw err;
  }
}

// Reset nonce tracker (useful for testing)
function resetNonceTracker(address = null) {
  if (address) {
    delete nonceTracker[address];
  } else {
    Object.keys(nonceTracker).forEach(key => delete nonceTracker[key]);
  }
}

module.exports = {
  signTransaction,
  getNonce,
  resetNonceTracker,
  web3,
  config
};