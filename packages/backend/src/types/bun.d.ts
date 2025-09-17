declare global {
  namespace Bun {
    interface Password {
      hash(password: string): Promise<string>;
      verify(password: string, hash: string): Promise<boolean>;
    }

    interface ServeOptions {
      port?: number;
      hostname?: string;
      fetch: (request: Request) => Response | Promise<Response>;
      websocket?: {
        message: (ws: any, message: any) => void;
        open?: (ws: any) => void;
        close?: (ws: any) => void;
        error?: (ws: any, error: Error) => void;
      };
    }

    function serve(options: ServeOptions): any;
    function serve(port: number, fetch: (request: Request) => Response | Promise<Response>): any;
    function upgradeWebSocket(request: Request): { socket: any; response: Response };
  }

  const Bun: {
    password: Bun.Password;
    serve: typeof Bun.serve;
    upgradeWebSocket: (request: Request) => { socket: any; response: Response };
  };
}

export { };

