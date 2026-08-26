import Redis from 'ioredis';

/**
 * Create the shared BullMQ Redis connection.
 *
 * `maxRetriesPerRequest: null` is required by BullMQ workers so commands wait
 * during reconnects instead of failing mid-job.
 */
export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}
