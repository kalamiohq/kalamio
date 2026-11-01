import mongoose from 'mongoose';

// Initial-connection retry policy. We retry INDEFINITELY with capped exponential backoff
// rather than giving up after a fixed count. A cold Atlas cluster (e.g. M0) can take
// 20-30s to answer, and a Cloud Run instance that cold-starts during that window would
// otherwise exhaust its retries and run "without DB" for its whole lifetime — 500ing
// every request until it's manually restarted. The HTTP server is already listening
// before this runs (see server.js), so retrying forever never blocks startup; the
// instance simply self-heals once the cluster answers. Mongoose handles reconnection on
// its own AFTER the first successful connect — this loop only covers getting that first one.
const INITIAL_RETRY_DELAY_MS = 3000;
const MAX_RETRY_DELAY_MS = 30000;

// Mongoose's 'disconnected' event only says the primary went away. Log why, so a flap names its cause
// ("connection <monitor> ..." is the heartbeat, "connection 2 ..." is a pool connection).
export const logServerLoss = (client) => {
    client.on('serverDescriptionChanged', ({ address, newDescription }) => {
        if (newDescription.type === 'Unknown' && newDescription.error) {
            console.warn(`⚠️  MongoDB server ${address} lost: ${newDescription.error.message}`);
        }
    });
};

const connectDB = async () => {
    for (let attempt = 1; ; attempt++) {
        try {
            const conn = await mongoose.connect(process.env.DB_LOCATION, {
                autoIndex: true,
                serverSelectionTimeoutMS: 10000,
                // Connection pool settings
                maxPoolSize: 10,          // Max concurrent connections to MongoDB
                // A new connection costs a TLS + auth handshake, about 1.4s from Cloud Run to Atlas.
                // Keep enough warm for the overlapping requests of one page load.
                minPoolSize: 5,
                // Close idle connections after 10 min, under Cloud Run's 20-min limit for idle outbound
                // connections. At 30s the idle instance redid about 12 handshakes a minute.
                maxIdleTimeMS: 600000,
                connectTimeoutMS: 45000,  // Timeout for initial connection
                socketTimeoutMS: 45000,   // Timeout for socket operations
            });
            console.log(`✅ MongoDB connected: ${conn.connection.host}`);
            logServerLoss(conn.connection.getClient());
            return;
        } catch (err) {
            // Exponential backoff, capped: 3s → 6s → 12s → 24s → 30s → 30s …
            const delay = Math.min(INITIAL_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
            console.error(`❌ MongoDB connection attempt ${attempt} failed: ${err.message}`);
            console.log(`🔄 Retrying in ${Math.round(delay / 1000)}s (will keep retrying until connected)…`);
            await new Promise(res => setTimeout(res, delay));
        }
    }
};

// Monitor connection events
mongoose.connection.on('error', (err) => {
    console.error('⚠️  MongoDB connection error:', err.message);
});

mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
    console.log('✅ MongoDB reconnected');
});

export default connectDB;

