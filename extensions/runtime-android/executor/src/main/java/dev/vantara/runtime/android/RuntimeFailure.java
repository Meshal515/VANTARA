package dev.vantara.runtime.android;

/** Codes describe this operation/generation; they are not source-health verdicts. */
public final class RuntimeFailure extends RuntimeException {
    public final String code;
    RuntimeFailure(String code) { super(code); this.code=code; }
}
