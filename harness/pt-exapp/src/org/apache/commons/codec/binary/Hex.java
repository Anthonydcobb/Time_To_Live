package org.apache.commons.codec.binary;

public final class Hex {
    private static final char[] DIGITS = "0123456789abcdef".toCharArray();

    private Hex() {}

    public static char[] encodeHex(byte[] data) {
        char[] result = new char[data.length * 2];
        for (int i = 0; i < data.length; i++) {
            int value = data[i] & 0xff;
            result[i * 2] = DIGITS[value >>> 4];
            result[i * 2 + 1] = DIGITS[value & 0x0f];
        }
        return result;
    }

    public static String encodeHexString(byte[] data) {
        return new String(encodeHex(data));
    }
}
