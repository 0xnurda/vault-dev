// Anchor и web3.js написаны под Node и используют Buffer. В браузере его нет — подкладываем.
import { Buffer } from "buffer";

if (!(globalThis as any).Buffer) (globalThis as any).Buffer = Buffer;
