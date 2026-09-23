"use client";

// Composant assistant-ui vendorisé (registry `styles/base-nova/thread`, flavor Base UI),
// localisé en français (textes visibles et libellés accessibles uniquement).
// Ne pas écraser via `assistant-ui add --overwrite` sans reporter la traduction ni les
// changements ci-dessous — voir AGENTS.md, section `src/components/assistant-ui/`.
//
// Changements par rapport au registry :
// - `ThreadConfigContext` : les réglages par surface (placeholder, bouton d'image,
//   texte « réfléchit… », rendu du texte, contenu au-dessus des messages) passent
//   par des props, pour que le Coach et le Chef partagent ce seul fichier ;
// - retirés, parce que le chat n'en a pas (hors périmètre de #110) : accueil et
//   suggestions, suggestions de relance, barres d'action (copier, régénérer, menu
//   « plus »), édition, branches, dictée, messages vocaux, raisonnement, groupes de
//   tâches, parts `file`/`image`, bouton d'arrêt. `ActionBarMorePrimitive` était
//   aussi un menu Radix : il n'a rien à faire dans l'app (#69) ;
// - aucun regroupement des outils : chaque outil est enregistré en `standalone`
//   et un outil inconnu passe par `ToolFallback`, jamais par un groupe replié ;
// - l'indicateur « réfléchit… » seulement sur une réponse encore vide
//   (`indicator="empty"`) ;
// - `autoScroll` forcé sur le viewport (voir le commentaire sur place) ;
// - la mise en page reprend celle d'avant (`ai-elements`) : bulle utilisateur,
//   `text-sm`, `role="log"`, composer en bas de la zone de lecture.

import { UserMessageAttachments, ComposerAddAttachment, ComposerAttachments } from "@/components/assistant-ui/attachment";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  ComposerPrimitive,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  ThreadPrimitive,
  type ToolCallMessagePartComponent,
  useAuiState,
} from "@assistant-ui/react";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { createContext, useContext, useMemo, type ComponentType, type FC, type ReactNode } from "react";

/**
 * Component overrides for the thread. Tool UIs registered by name
 * (`makeAssistantToolUI`) take precedence over `ToolFallback`.
 */
export type ThreadComponents = {
  /** An assistant text part. Defaults to the raw text. */
  Text?: ComponentType<{ text: string }> | undefined;
  ToolFallback?: ToolCallMessagePartComponent | undefined;
};

export type ThreadProps = {
  /** Keep this object referentially stable (module scope): a new one remounts
   *  every message. */
  components?: ThreadComponents | undefined;
  /** Rendered at the top of the scroller, above the messages: the skeleton while
   *  the thread is unknown, « charger plus » once it is. */
  aboveMessages?: ReactNode | undefined;
  /** Extra classes on the message list — `ph-mask` keeps it out of replays. */
  messagesClassName?: string | undefined;
  composerPlaceholder?: string | undefined;
  /** Accessible name of the attach button. No label, no button. */
  attachLabel?: string | undefined;
  /** The placeholder reply while the turn hasn't produced anything yet. */
  thinking?: string | undefined;
};

const EMPTY_COMPONENTS: ThreadComponents = {};
const EMPTY_CONFIG: ThreadProps = {};

const ThreadConfigContext = createContext<Omit<ThreadProps, "aboveMessages">>(EMPTY_CONFIG);
const useThreadConfig = () => useContext(ThreadConfigContext);
const useThreadComponents = () => useThreadConfig().components ?? EMPTY_COMPONENTS;

// No group at all: every agent tool is registered as `standalone`, and an unknown
// tool still renders on its own line rather than folded into « 3 outils ».
const messageGroupBy = groupPartByType({
  "tool-call": [],
  "standalone-tool-call": [],
});

export const Thread: FC<ThreadProps> = ({
  components,
  aboveMessages,
  messagesClassName,
  composerPlaceholder,
  attachLabel,
  thinking,
}) => {
  // Rebuilt from its fields rather than passing `props` through: the chat
  // re-renders on every streamed delta, and a new context value each time would
  // re-render every message with it. `aboveMessages` stays out of it for the
  // same reason — it's fresh JSX on each render.
  const config = useMemo(
    () => ({ components, messagesClassName, composerPlaceholder, attachLabel, thinking }),
    [components, messagesClassName, composerPlaceholder, attachLabel, thinking],
  );
  return (
    <ThreadConfigContext.Provider value={config}>
      <ThreadRoot aboveMessages={aboveMessages} />
    </ThreadConfigContext.Provider>
  );
};

const ThreadRoot: FC<{ aboveMessages: ReactNode }> = ({ aboveMessages }) => {
  const { messagesClassName } = useThreadConfig();

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root @container flex h-full flex-col bg-background"
      style={{
        ["--thread-max-width" as string]: "44rem",
        ["--composer-bg" as string]: "color-mix(in oklab, var(--color-muted) 30%, transparent)",
        ["--composer-radius" as string]: "1rem",
        ["--composer-padding" as string]: "8px",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        // Modifié : `turnAnchor="top"` coupe l'auto-scroll par défaut. Or un fil
        // ouvert au repos grandit après coup — les cartes chargent leurs données
        // (ChoicesCard, ProgramCard) — et restait arrêté au-dessus du bas.
        autoScroll
        data-slot="aui_thread-viewport"
        // A live transcript: assistive tech announces what gets appended.
        role="log"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth"
      >
        <div className="mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-2 pt-4">
          <div
            data-slot="aui_message-group"
            className={cn("mb-6 flex flex-col gap-4 px-2 empty:hidden", messagesClassName)}
          >
            {aboveMessages}
            <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
          </div>

          <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer sticky bottom-0 mt-auto flex flex-col gap-4 overflow-visible bg-background pb-2">
            <ThreadScrollToBottom />
            <Composer />
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  if (role === "user") return <UserMessage />;
  return <AssistantMessage />;
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Aller en bas"
        variant="outline"
        className="aui-thread-scroll-to-bottom absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible dark:border-border dark:bg-background dark:hover:bg-accent"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const Composer: FC = () => {
  const { composerPlaceholder, attachLabel } = useThreadConfig();

  return (
    <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
      <ComposerPrimitive.AttachmentDropzone asChild>
        <div
          data-slot="aui_composer-shell"
          className="flex w-full cursor-text flex-col gap-2 rounded-(--composer-radius) border border-foreground/10 bg-(--composer-bg) p-(--composer-padding) transition-[border-color] focus-within:border-foreground/25 data-[dragging=true]:border-dashed data-[dragging=true]:border-ring data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_50%,var(--color-background))]"
        >
          <ComposerAttachments />
          <ComposerPrimitive.Input
            placeholder={composerPlaceholder ?? "Écris un message…"}
            // 16 px on phones: iOS zooms into any field under that on focus.
            className="aui-composer-input max-h-48 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base leading-6 caret-primary outline-none placeholder:text-muted-foreground/60 sm:text-sm"
            rows={1}
            enterKeyHint="send"
            aria-label="Ton message"
          />
          <div className="aui-composer-action-wrapper relative flex items-center justify-between">
            {attachLabel ? <ComposerAddAttachment label={attachLabel} /> : <div />}
            <ComposerPrimitive.Send asChild>
              <TooltipIconButton
                tooltip="Envoyer"
                side="bottom"
                type="button"
                variant="default"
                size="icon"
                className="aui-composer-send size-7 rounded-full"
                aria-label="Envoyer"
              >
                <ArrowUpIcon className="aui-composer-send-icon size-4" />
              </TooltipIconButton>
            </ComposerPrimitive.Send>
          </div>
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive dark:bg-destructive/5 dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const PlainText: FC<{ text: string }> = ({ text }) => <p className="whitespace-pre-wrap">{text}</p>;

const AssistantMessage: FC = () => {
  const { thinking } = useThreadConfig();
  const { Text = PlainText, ToolFallback } = useThreadComponents();

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      // 95 %, like the user side and like before: a reply never quite touches
      // both edges of a phone screen.
      className="fade-in slide-in-from-bottom-1 animate-in w-full max-w-[95%] duration-150"
    >
      {/* Full width: the review cards live in the assistant's content. */}
      <div
        data-slot="aui_assistant-message-content"
        className="flex w-full min-w-0 flex-col gap-2 text-sm wrap-break-word text-foreground"
      >
        {/* `empty`, not the default `no-text`: a tool line already shimmers
            while it runs, and « réfléchit… » under it said the same thing twice. */}
        <MessagePrimitive.GroupedParts groupBy={messageGroupBy} indicator="empty">
          {({ part }) => {
            switch (part.type) {
              case "text":
                return <Text text={part.text} />;
              case "tool-call":
                return part.toolUI ?? (ToolFallback ? <ToolFallback {...part} /> : null);
              case "indicator":
                return (
                  <span
                    data-slot="aui_assistant-message-indicator"
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                  >
                    <Spinner /> {thinking ?? "Un instant…"}
                  </span>
                );
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <MessageError />
      </div>
    </MessagePrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      data-role="user"
      className="fade-in slide-in-from-bottom-1 animate-in ml-auto flex w-full max-w-[95%] flex-col items-end gap-2 duration-150"
    >
      <UserMessageAttachments />
      <div className="aui-user-message-content w-fit max-w-full min-w-0 rounded-lg bg-secondary px-4 py-3 text-sm wrap-break-word text-foreground empty:hidden">
        <MessagePrimitive.Parts>
          {({ part }) => (part.type === "text" ? <span>{part.text}</span> : null)}
        </MessagePrimitive.Parts>
      </div>
    </MessagePrimitive.Root>
  );
};
