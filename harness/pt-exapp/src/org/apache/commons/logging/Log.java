package org.apache.commons.logging;

public interface Log {
    default boolean isDebugEnabled() { return false; }
    default boolean isErrorEnabled() { return false; }
    default boolean isFatalEnabled() { return false; }
    default boolean isInfoEnabled() { return false; }
    default boolean isTraceEnabled() { return false; }
    default boolean isWarnEnabled() { return false; }
    default void debug(Object message) {}
    default void debug(Object message, Throwable error) {}
    default void error(Object message) {}
    default void error(Object message, Throwable error) {}
    default void fatal(Object message) {}
    default void fatal(Object message, Throwable error) {}
    default void info(Object message) {}
    default void info(Object message, Throwable error) {}
    default void trace(Object message) {}
    default void trace(Object message, Throwable error) {}
    default void warn(Object message) {}
    default void warn(Object message, Throwable error) {}
}
