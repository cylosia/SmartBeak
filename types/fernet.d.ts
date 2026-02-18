declare module 'fernet' {
  export class Fernet {
    constructor(key: string);
    encrypt(input: string): string;
    /**
     * Decrypt a Fernet token.
     * @throws {Error} if the token is malformed, the HMAC is invalid,
     *   the token has expired, or the key does not match.
     * ALL call sites MUST wrap this in try/catch.
     */
    decrypt(token: string): string;
    static Token: {
      /** @throws {Error} if tokenString is not valid base64url Fernet format */
      parse: (tokenString: string) => { secret: Buffer; };
    };
    static randomIV(): Buffer;
  }
}
