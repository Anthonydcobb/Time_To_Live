package org.apache.commons.lang;

public final class StringUtils {
    private StringUtils() {}

    public static boolean equalsIgnoreCase(String left, String right) {
        if (left == null) return right == null;
        return left.equalsIgnoreCase(right);
    }
}
