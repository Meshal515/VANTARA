package dev.vantara.runtime.fixtures;

import dev.vantara.runtime.api.*;

/** Unsupported integration is distinct from a broken source or a crashed worker. */
public final class UnsupportedProvider implements RuntimeProvider {
    public void initialize(RuntimeAccess access){}
    public String invoke(String operation,String input,RuntimeAccess access){throw new UnsupportedOperationException("fixture capability");}
}
