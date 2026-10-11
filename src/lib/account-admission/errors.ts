import { ApiError } from "@/lib/errors/api-error";

export class AccountAdmissionError extends ApiError {
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(status, message);
    this.name = "AccountAdmissionError";
    this.code = code;
  }
}
