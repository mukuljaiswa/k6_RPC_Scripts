const e = require('express');
const fs = require('fs');
const path = require('path');

const LOG_FILE = 'transaction_history.csv';
const CSV_HEADER = 'Sender Address,Transaction Hash,Status,Nonce\n';

// Ensure the log file exists with headers
function ensureLogFile() {
    if (!fs.existsSync(LOG_FILE)) {
        fs.writeFileSync(LOG_FILE, CSV_HEADER);
    }
}

// Log a transaction to the CSV file
async function logTransaction({ senderAddress, transactionHash, status, nonce }) {
    try {
        ensureLogFile();
        
        if (status==200){
            status = 'success';
        }else{
            status = 'failed';

        }

        const csvRow = `"${senderAddress}","${transactionHash}","${status}","${nonce}"\n`;
        fs.appendFileSync(LOG_FILE, csvRow);
        
    } catch (err) {
        console.error('Error logging transaction:', err);
        throw err;
    }
}

module.exports = {
    logTransaction
};