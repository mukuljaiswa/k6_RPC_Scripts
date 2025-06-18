export class AddressManager {
    constructor(senders, receivers) {
        this.senders = senders;
        this.receivers = receivers;

        this.senderIndex = 0;
        this.receiverIndex = 0;
        this.usedSendersInCycle = new Set();

        this.lock = false;
    }

    acquireLock() {
        while (this.lock) {
            const waitUntil = Date.now() + 1;
            while (Date.now() < waitUntil) {}
        }
        this.lock = true;
    }

    releaseLock() {
        this.lock = false;
    }

    getNextAddressPair() {
        this.acquireLock();
        try {
            // Reset if all senders have been used
            if (this.usedSendersInCycle.size >= this.senders.length) {
                this.usedSendersInCycle.clear();
                this.senderIndex = 0;
            }

            let sender;
            while (true) {
                const candidate = this.senders[this.senderIndex % this.senders.length];
                this.senderIndex++;
                if (!this.usedSendersInCycle.has(candidate.address)) {
                    sender = candidate;
                    this.usedSendersInCycle.add(candidate.address);
                    break;
                }
            }

            const receiver = this.receivers[this.receiverIndex % this.receivers.length];
            this.receiverIndex++;

            return { sender, receiver };
        } finally {
            this.releaseLock();
        }
    }
}
