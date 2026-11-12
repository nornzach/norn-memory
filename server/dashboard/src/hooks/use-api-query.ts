import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-message";

interface UseApiQueryOptions<T> {
  enabled?: boolean;
  errorToast?: string;
  initialData?: T;
}

interface UseApiQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  error: string;
  refetch: () => Promise<void>;
}

export function useApiQuery<T>(
  fetcher: () => Promise<T>,
  options: UseApiQueryOptions<T> = {},
): UseApiQueryResult<T> {
  const { enabled = true, errorToast, initialData } = options;

  const [data, setData] = useState<T | undefined>(initialData);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState("");

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // Only the latest request may set state, so a slow earlier reply can't overwrite a newer one.
  const latest = useRef(0);

  const run = useCallback(async () => {
    const request = ++latest.current;
    setIsLoading(true);
    setError("");
    try {
      const result = await fetcherRef.current();
      if (request === latest.current) setData(result);
    } catch (err) {
      if (request !== latest.current) return;
      const message = getErrorMessage(err, errorToast || "Request failed");
      setError(message);
      if (errorToast) {
        toast({
          title: errorToast,
          description: message,
          variant: "destructive",
        });
      }
    } finally {
      if (request === latest.current) setIsLoading(false);
    }
  }, [errorToast]);

  useEffect(() => {
    if (enabled) void run();
  }, [enabled, run]);

  return { data, isLoading, error, refetch: run };
}
