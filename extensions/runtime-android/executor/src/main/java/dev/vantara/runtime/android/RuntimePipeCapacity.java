package dev.vantara.runtime.android;

import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

/** Bounded writer admission, separate from Android descriptor operations. */
final class RuntimePipeCapacity {
    static void acquire(Semaphore capacity,BooleanSupplier closed,long deadlineNanos) {
        for(;;){
            long remaining=remaining(closed,deadlineNanos);
            try {
                if(!capacity.tryAcquire(Math.min(remaining,TimeUnit.MILLISECONDS.toNanos(25)),TimeUnit.NANOSECONDS))continue;
            }catch(InterruptedException interrupted){
                Thread.currentThread().interrupt();throw new RuntimeFailure("WORKER_CLOSED");
            }
            // Closing can race with permit acquisition. A rejected frame owns no slot.
            try{remaining(closed,deadlineNanos);return;}
            catch(RuntimeException failure){capacity.release();throw failure;}
        }
    }
    private static long remaining(BooleanSupplier closed,long deadlineNanos){
        if(closed.getAsBoolean()||Thread.currentThread().isInterrupted())throw new RuntimeFailure("WORKER_CLOSED");
        long remaining=deadlineNanos-System.nanoTime();
        if(remaining<=0)throw new RuntimeFailure("PIPE_TIMEOUT");
        return remaining;
    }
    private RuntimePipeCapacity(){}
}
