import { Injectable, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';

export type Provenance = { mode: 'demo' | 'live'; model_version: string; prompt_version: string };
export type GraphResult<T> = { status: string; payload: T; provenance: Provenance };

/** The only route to the private AI service. Its token never leaves the backend. */
@Injectable()
export class AiClient {
  private async post<T>(path: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${process.env.AI_SERVICE_URL}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-service-token': process.env.AI_SERVICE_TOKEN ?? '' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ServiceUnavailableException('The AI service is unavailable');
    }
    if (response.status === 409 || response.status === 422) throw new UnprocessableEntityException('The AI service refused this request');
    if (!response.ok) throw new ServiceUnavailableException('The AI service is unavailable');
    return response.json() as Promise<T>;
  }

  analyzeCv<T>(body: { file_base64: string; known_names: string[] }) {
    return this.post<T>('/cv/analyze', body);
  }

  run<T>(graph: 'assessment-builder' | 'evaluation', body: unknown) {
    return this.post<GraphResult<T>>(`/graphs/${graph}/runs`, body);
  }

  resume<T>(graph: 'assessment-builder' | 'evaluation', threadId: string, value: unknown) {
    return this.post<Omit<GraphResult<T>, 'provenance'>>(`/graphs/${graph}/runs/${threadId}/resume`, { value });
  }
}
