export class AddressManager {
    constructor(senders, receivers) {
        this.senders = senders;
        this.receivers = receivers;
        this.vuStates = new Map(); // Track state per VU
        this.lock = false; // Still need locking for receiver index
    }

    getNextAddressPair(vuId) {
        // Simple locking mechanism for thread safety
        while (this.lock) {
            const waitUntil = Date.now() + 10;
            while (Date.now() < waitUntil) {}
        }

        this.lock = true;
        try {
            // Initialize VU state if not exists
            if (!this.vuStates.has(vuId)) {
                this.vuStates.set(vuId, {
                    sender: this.senders[(vuId - 1) % this.senders.length],
                    usedReceivers: new Set(),
                    lastReceiverIndex: 0
                });
            }

            const vuState = this.vuStates.get(vuId);
            const sender = vuState.sender;
            
            // Find next unused receiver for this VU
            let receiver;
            let attempts = 0;
            const maxAttempts = this.receivers.length;
            
            do {
                receiver = this.receivers[vuState.lastReceiverIndex % this.receivers.length];
                vuState.lastReceiverIndex++;
                attempts++;
                
                if (attempts >= maxAttempts) {
                    throw new Error(`No unused receivers left for VU ${vuId}`);
                }
            } while (vuState.usedReceivers.has(receiver));
            
            vuState.usedReceivers.add(receiver);
            
            return { sender, receiver };
        } finally {
            this.lock = false;
        }
    }

    resetCounters() {
        this.lock = true;
        try {
            this.vuStates.clear();
        } finally {
            this.lock = false;
        }
    }
}