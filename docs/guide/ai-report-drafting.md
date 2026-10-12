# Draft a report with AI

Describe the report in plain words, and let AI write the first draft. Use it to start a report quickly, or to ask for a change in an existing one. Every draft is checked and test-rendered before you see it. Nothing is saved until you save it.

## In the UI

Start a new report:

1. On the home page (`/`), click **Describe a report (AI)**.
2. In **What should the report show?**, describe it. For example: "Monthly sales by region with a chart".
3. Optional: paste sample rows as JSON in **Sample rows as JSON (optional; sent to the AI service)**.
4. Press **Draft the report**. It can take up to a minute ("Drafting… (up to a minute)").
5. Press **Open in the designer** to review and save.

Change an existing report:

1. Open the report in the designer. Click **Ask AI** in the toolbar. Describe the change.
2. The change appears with a rendered preview. It is applied as one step, so **Undo** reverts it.

## From the CLI

Not available in the CLI.

## Through the API

Needs a sign-in session (designer or admin) and an `Origin` header. Draft:

```bash
curl -sS -X POST http://localhost:3000/api/ai/report \
  -b cookies.txt -H "Origin: http://localhost:3000" -H "content-type: application/json" \
  -d '{"prompt":"Monthly sales by region with a chart","sample":[{"region":"North","month":"2026-01","amount":1200},{"region":"South","month":"2026-01","amount":950}]}'
```

Optional fields, as in `README.md`: `url` and `base` (a report id to change). The answer is `{ definition, warnings, tries }`. Nothing is saved.

Save the draft when you accept it:

```bash
curl -sS -X POST http://localhost:3000/api/reports \
  -b cookies.txt -H "Origin: http://localhost:3000" -H "content-type: application/json" \
  -d '{"name":"Monthly sales by region","definition":{ ...the definition from the draft... }}'
```

## Notes

- Needs `ANTHROPIC_API_KEY` on the server. The model defaults to `claude-opus-5`. Override with `PW_AI_MODEL`.
- In production, AI drafting also needs a sign-in, because every draft costs money.
- Your sample rows are sent to the Anthropic API. Send a few representative rows, not personal data you may not share.
- Each draft is checked with `validate()` and a trial render on your sample rows. Problems go back to the model, up to 3 tries in all.
- A refusal comes back as a clear `422`.
- The trial render uses only your sample rows. It does not fetch data from the network.
