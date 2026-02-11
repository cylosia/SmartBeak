declare module 'fernet' {
  export class Fernet {
    constructor(key: string);
    encrypt(input: string): string;
    decrypt(token: string): string;
    static Token: {
      parse: (tokenString: string) => { secret: Buffer; };
    };
    static randomIV(): Buffer;
  }
}
