# Third-party notices

This project includes modified UI components from [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin), revision `e16c87f213a5ba5e45964e9b67c792105ec74d26`, retrieved 2026-10-02. Files: `src/components/ui/button.tsx`, `card.tsx`, `badge.tsx`. The upstream MIT license is preserved in `LICENSE.shadcn-admin`.

The remaining implementation is specific to this personal workbench. Dependencies retain their own licenses in their npm packages. No third-party dashboard authentication, billing configuration or credentials were copied.

The English study center uses [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), npm version `5.4.2`, to compute review schedules on the server. Its MIT license is preserved in `LICENSE.ts-fsrs`.

The vocabulary, contextual reading and sentence player interactions were informed by [TypeWords](https://github.com/zyronon/TypeWords), [Lute](https://github.com/LuteOrg/lute-v3) and [EchoFlow](https://github.com/luzhenhua/echo-flow). Their source code, wordbooks and media were not copied. Introductory text and definitions are authored for this workbench; example speech was synthesized offline using eSpeak NG. No eSpeak engine code is shipped in the application.
