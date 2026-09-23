"use client";

// Hook assistant-ui vendorisé (registry `base/use-attachment-src`, installé par
// défaut dans `hooks/`). Modifié : deux sélecteurs `useAuiState` qui rendent chacun
// une valeur stable au lieu d'un objet passé à `useShallow` — ça évite d'ajouter
// `zustand` aux dépendances pour une seule comparaison. Ne pas écraser via
// `assistant-ui add --overwrite` sans reporter ce changement.

import { useEffect, useState } from "react";
import { useAuiState } from "@assistant-ui/react";

const useFileSrc = (file: File | undefined) => {
  const [entry, setEntry] = useState<{ file: File; url: string } | undefined>(undefined);

  useEffect(() => {
    // The object URL is a browser resource whose lifetime has to straddle
    // commit, so allocation, revocation, and clearing the entry that names a
    // revoked URL all belong to the effect.
    if (!file) {
      setEntry(undefined);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setEntry({ file, url: objectUrl });

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return entry !== undefined && entry.file === file ? entry.url : undefined;
};

export const useAttachmentSrc = () => {
  const file = useAuiState((s) =>
    s.attachment.type === "image" ? s.attachment.file : undefined,
  );
  const src = useAuiState((s) =>
    s.attachment.type === "image" && !s.attachment.file
      ? s.attachment.content?.find((c) => c.type === "image")?.image
      : undefined,
  );

  return useFileSrc(file) ?? src;
};
