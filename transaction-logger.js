const e = require('express');
const fs = require('fs');
const path = require('path');

let LOG_FILE = ''; // Will be initialized when server starts

// Initialize the log file with current UTC time
function initializeLogFile() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = './transaction_history';
    
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    
    LOG_FILE = `${dir}/transaction_history_${timestamp}.csv`;
    fs.writeFileSync(LOG_FILE, CSV_HEADER);
    console.log(`Transaction log file created: ${LOG_FILE}`);
}

const CSV_HEADER = 'Sender Address,Transaction Hash,Status,Nonce\n';

// Log a transaction to the CSV file
async function logTransaction({ senderAddress, transactionHash, status, nonce }) {
    try {
        // If LOG_FILE hasn't been initialized yet, initialize it
        if (!LOG_FILE) {
            initializeLogFile();
        }
        
        status = status == 200 ? 'success' : 'failed';

        const csvRow = `"${senderAddress}","${transactionHash}","${status}","${nonce}"\n`;
        fs.appendFileSync(LOG_FILE, csvRow);
        
    } catch (err) {
        console.error('Error logging transaction:', err);
        throw err;
    }
}

module.exports = {
    logTransaction,
    initializeLogFile // Export this so we can call it when server starts
};