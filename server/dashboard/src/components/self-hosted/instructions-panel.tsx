"use client";

import { FormEvent, useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
} from "@/components/shared/page";
import { Field } from "@/components/shared/field";
import { toast } from "@/components/ui/use-toast";
import { getErrorMessage } from "@/lib/error-message";
import { api } from "@/utils/api";
import { MEMORY_ENDPOINTS } from "@/utils/api-endpoints";
import { useI18n } from "@/i18n/provider";

// Long enough for detailed guidance, short enough to stay a small part of every extraction prompt.
const MAX_LENGTH = 4000;

interface InstructionsPanelProps {
  /** The saved instructions; undefined while the configuration loads. */
  saved: string | undefined;
  disabled: boolean;
  onSaved: () => Promise<unknown> | void;
}

/** Custom instructions: what the LLM should keep, and leave out, when it extracts memories. */
export function InstructionsPanel({
  saved,
  disabled,
  onSaved,
}: InstructionsPanelProps) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [useCase, setUseCase] = useState("");
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);

  useEffect(() => {
    if (saved !== undefined) setText(saved);
  }, [saved]);

  const changed = saved !== undefined && text.trim() !== saved.trim();

  const handleDraft = async () => {
    if (!useCase.trim()) return;
    setDrafting(true);
    try {
      const res = await api.post<{ custom_instructions: string }>(
        MEMORY_ENDPOINTS.GENERATE_INSTRUCTIONS,
        { use_case: useCase.trim() },
      );
      setText(res.data.custom_instructions.slice(0, MAX_LENGTH));
    } catch (err) {
      toast({
        title: t.configuration.instructionsDraftFailed,
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setDrafting(false);
    }
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.post(MEMORY_ENDPOINTS.CONFIGURE, {
        custom_instructions: text.trim(),
      });
      toast({ title: t.configuration.instructionsSaved, variant: "success" });
      await onSaved();
    } catch (err) {
      toast({
        title: t.configuration.saveFailed,
        description: getErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel as="div" className="mt-4 sm:mt-6">
      <form onSubmit={handleSave}>
        <PanelHeader
          title={t.configuration.instructionsTitle}
          description={t.configuration.instructionsDescription}
        />
        <PanelBody className="space-y-4">
          <Field
            id="custom-instructions"
            label={t.configuration.instructionsLabel}
            hint={t.configuration.instructionsHint(text.length, MAX_LENGTH)}
          >
            <Textarea
              id="custom-instructions"
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
              placeholder={t.configuration.instructionsPlaceholder}
              rows={7}
              disabled={disabled || saved === undefined}
              className="leading-6"
            />
          </Field>
          {!disabled && (
            <Field
              id="custom-instructions-use-case"
              label={t.configuration.instructionsDraftLabel}
              hint={t.configuration.instructionsDraftHint}
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="custom-instructions-use-case"
                  value={useCase}
                  onChange={(e) => setUseCase(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleDraft();
                    }
                  }}
                  placeholder={t.configuration.instructionsDraftPlaceholder}
                  className="sm:flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleDraft()}
                  disabled={!useCase.trim() || drafting}
                >
                  {drafting ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Sparkles aria-hidden />
                  )}
                  {t.configuration.instructionsDraft}
                </Button>
              </div>
            </Field>
          )}
        </PanelBody>
        {!disabled && (
          <PanelFooter className="sm:justify-end">
            {changed && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setText(saved ?? "")}
                disabled={saving}
              >
                {t.common.cancel}
              </Button>
            )}
            <Button type="submit" disabled={!changed || saving}>
              {saving && <Loader2 className="animate-spin" aria-hidden />}
              {t.configuration.instructionsSave}
            </Button>
          </PanelFooter>
        )}
      </form>
    </Panel>
  );
}
