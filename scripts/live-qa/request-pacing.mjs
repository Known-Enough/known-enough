import { setTimeout as wait } from 'node:timers/promises';
/** One queue for the isolated synthetic workload; never retries or sends requests. */
export function createRequestPacer(now = Date.now, sleep = wait) {
    let next = 0;
    let queue = Promise.resolve();
    return () => {
        const turn = queue.then(async () => {
            const delay = next - now();
            if (delay > 0) await sleep(delay);
            next = now() + 1000;
        });
        queue = turn.catch(() => {});
        return turn;
    };
}
