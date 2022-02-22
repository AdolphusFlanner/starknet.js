import { Provider } from '../provider';
import { Signer, SignerInterface } from '../signer';
import {
  Abi,
  AddTransactionResponse,
  ExecuteInvocation,
  InvocationsDetails,
  KeyPair,
  Signature,
} from '../types';
import { BigNumberish, bigNumberishArrayToDecimalStringArray, toBN, toHex } from '../utils/number';
import { compileCalldata, getSelectorFromName } from '../utils/stark';
import { TypedData, getMessageHash } from '../utils/typedData';
import { AccountInterface } from './interface';

export class Account extends Provider implements AccountInterface {
  public address: string;

  private signer: SignerInterface;

  constructor(provider: Provider, address: string, keyPair: KeyPair) {
    super(provider);
    this.signer = new Signer(keyPair);
    this.address = address;
  }

  public async getNonce(): Promise<string> {
    const { result } = await this.callContract({
      contractAddress: this.address,
      entrypoint: 'get_nonce',
    });
    return toHex(toBN(result[0]));
  }

  /**
   * Invoke execute function in account contract
   *
   * [Reference](https://github.com/starkware-libs/cairo-lang/blob/f464ec4797361b6be8989e36e02ec690e74ef285/src/starkware/starknet/services/api/gateway/gateway_client.py#L13-L17)
   *
   * @param transaction - transaction to be invoked
   * @returns a confirmation of invoking a function on the starknet contract
   */
  public async execute(
    transactions: ExecuteInvocation | ExecuteInvocation[],
    abis: Abi[] = [],
    transactionsDetail: InvocationsDetails = {}
  ): Promise<AddTransactionResponse> {
    if (Array.isArray(transactions) && transactions.length !== 1) {
      throw new Error('Only one transaction at a time is currently supported');
    }

    const {
      contractAddress,
      calldata = [],
      entrypoint,
      ...invocation
    } = Array.isArray(transactions) ? transactions[0] : transactions;
    const { nonce } = transactionsDetail;

    const nonceBn = toBN(nonce ?? (await this.getNonce()));
    const calldataDecimal = bigNumberishArrayToDecimalStringArray(calldata);

    const signature = await this.signer.signTransaction(
      [
        {
          ...invocation,
          contractAddress,
          calldata: calldataDecimal,
          entrypoint,
        },
      ],
      { walletAddress: this.address, nonce: nonceBn },
      abis
    );

    const entrypointSelector = getSelectorFromName(entrypoint);

    return super.invokeFunction({
      contractAddress: this.address,
      entrypoint: 'execute',
      calldata: [
        contractAddress,
        entrypointSelector,
        calldataDecimal.length.toString(),
        ...calldataDecimal,
        nonceBn.toString(),
      ],
      signature,
    });
  }

  /**
   * Sign an JSON object with the starknet private key and return the signature
   *
   * @param json - JSON object to be signed
   * @returns the signature of the JSON object
   * @throws {Error} if the JSON object is not a valid JSON
   */
  public async signMessage(typedData: TypedData): Promise<Signature> {
    return this.signer.signMessage(typedData, this.address);
  }

  /**
   * Hash a JSON object with pederson hash and return the hash
   *
   * @param json - JSON object to be hashed
   * @returns the hash of the JSON object
   * @throws {Error} if the JSON object is not a valid JSON
   */
  public async hashMessage(typedData: TypedData): Promise<string> {
    return getMessageHash(typedData, this.address);
  }

  /**
   * Verify a signature of a JSON object
   *
   * @param json - JSON object to be verified
   * @param signature - signature of the JSON object
   * @returns true if the signature is valid, false otherwise
   * @throws {Error} if the JSON object is not a valid JSON or the signature is not a valid signature
   */
  public async verifyMessageHash(hash: BigNumberish, signature: Signature): Promise<boolean> {
    try {
      await this.callContract({
        contractAddress: this.address,
        entrypoint: 'is_valid_signature',
        calldata: compileCalldata({
          hash: toBN(hash).toString(),
          signature: signature.map((x) => toBN(x).toString()),
        }),
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Verify a signature of a given hash
   * @warning This method is not recommended, use verifyMessage instead
   *
   * @param hash - hash to be verified
   * @param signature - signature of the hash
   * @returns true if the signature is valid, false otherwise
   * @throws {Error} if the signature is not a valid signature
   */
  public async verifyMessage(typedData: TypedData, signature: Signature): Promise<boolean> {
    const hash = await this.hashMessage(typedData);
    return this.verifyMessageHash(hash, signature);
  }
}