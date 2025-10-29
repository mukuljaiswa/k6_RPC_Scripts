export function initializeLogger(logPath = './transaction_history') {
    console.log(`[LOGGER] Initialized - transaction logging enabled (console output only)`);
}

export function logTransaction(data) {
    try {
        const timestamp = new Date().toISOString();
        const logEntry = [
            timestamp,
            data.senderAddress,
            data.transactionHash || 'none',
            data.status,
            data.nonce || 'none',
            data.error || ''
        ].join(',');

        console.log(`[TX LOG] ${logEntry}`);
    } catch (error) {
        console.error('[LOGGER] Failed to log transaction:', error);
    }
}