package org.apache.commons.logging;

public final class LogFactory {
    private static final Log NO_OP = new Log() {};

    private LogFactory() {}

    public static Log getLog(Class<?> type) {
        return NO_OP;
    }

    public static Log getLog(String name) {
        return NO_OP;
    }
}
