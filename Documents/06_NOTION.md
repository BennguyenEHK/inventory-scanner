# STAGE 6 — NOTION DATABASE OPERATIONS
> Tool: Notion API (direct — no AI model involved)
> Trigger: user confirms qty / user requests update / delete / fetch

---

## DATABASE CONFIG
```
Database name : Inventory
API version   : 2022-06-28
Base URL      : https://api.notion.com/v1
Auth header   : Authorization: Bearer {NOTION_API_KEY}
```

---

## PROPERTY TYPE MAP
Coding agent must map fields to correct Notion property types:

```
itemId          → title       (array of text objects)
ItemName        → rich_text   (array of text objects)
itemDescription → rich_text
Qty             → number
Manufacturer    → rich_text
Length          → rich_text
Width           → rich_text
Market_Price    → number
Currency        → rich_text
Sales_Unit      → rich_text
Item_Origin     → rich_text
Ext_Price       → number
Notes           → rich_text
```

---

## INSERT — Create New Page

```
POST /pages

TRIGGER: user sends qty (e.g. "50" or "qty is 50")

BEFORE CALLING:
  item.Qty       = parsed integer from user message
  item.Ext_Price = item.Market_Price × item.Qty
  run CP3 verification from Stage 4

NOTION PAYLOAD:
{
  parent: { database_id: NOTION_DATABASE_ID },
  properties: {
    itemId:          { title:     [{ text: { content: item.itemId } }] },
    ItemName:        { rich_text: [{ text: { content: item.ItemName } }] },
    itemDescription: { rich_text: [{ text: { content: item.itemDescription } }] },
    Qty:             { number: item.Qty },
    Manufacturer:    { rich_text: [{ text: { content: item.Manufacturer } }] },
    Length:          { rich_text: [{ text: { content: item.Length } }] },
    Width:           { rich_text: [{ text: { content: item.Width } }] },
    Market_Price:    { number: item.Market_Price },
    Currency:        { rich_text: [{ text: { content: item.Currency } }] },
    Sales_Unit:      { rich_text: [{ text: { content: item.Sales_Unit } }] },
    Item_Origin:     { rich_text: [{ text: { content: item.Item_Origin } }] },
    Ext_Price:       { number: item.Ext_Price },
    Notes:           { rich_text: [{ text: { content: item.Notes } }] }
  }
}

SUCCESS RESPONSE FORMAT:
"✅ Saved — {itemId} | {ItemName} | Qty: {Qty} | Ext: ${Ext_Price}"

ERROR RESPONSE FORMAT:
"❌ Notion error: {error.message} — check property names and types"
```

---

## FETCH — Query Records

```
POST /databases/{NOTION_DATABASE_ID}/query

FETCH ALL:
{
  "page_size": 50
}

FETCH BY itemId:
{
  "filter": {
    "property": "itemId",
    "title": { "equals": "INV-20260605-0001" }
  }
}

FETCH BY MANUFACTURER:
{
  "filter": {
    "property": "Manufacturer",
    "rich_text": { "contains": "3M" }
  }
}

FETCH WITH SORT (newest first):
{
  "sorts": [{ "timestamp": "created_time", "direction": "descending" }],
  "page_size": 20
}

RESPONSE: extract page_id from each result for UPDATE/DELETE operations
```

---

## UPDATE — Modify Existing Record

```
PATCH /pages/{page_id}

TRIGGER: user says "update [itemId] qty to 75"

STEPS:
  1. FETCH to get page_id for itemId
  2. Recalculate Ext_Price with new Qty
  3. Append update note to Notes field

PAYLOAD (only send changed fields):
{
  "properties": {
    "Qty":        { "number": new_qty },
    "Ext_Price":  { "number": new_ext_price },
    "Notes":      { "rich_text": [{ "text": { "content": updated_notes } }] }
  }
}

NOTES UPDATE RULE:
  Append to existing Notes: "\nUpdated: Qty {old} → {new} | Ext ${old} → ${new}"
  Never overwrite existing Notes content

SUCCESS: "✅ Updated — {itemId} | Qty: {new_qty} | Ext: ${new_ext_price}"
```

---

## DELETE — Archive Record

```
PATCH /pages/{page_id}

NOTE: Notion API does not hard-delete — it archives.
Archived pages are hidden from queries but recoverable.

TRIGGER: user says "delete [itemId]"

PAYLOAD:
{
  "archived": true
}

CONFIRM BEFORE CALLING:
  prompt user: "Delete {itemId} ({ItemName})? This cannot be undone easily."
  only proceed on explicit confirmation

SUCCESS: "🗑️ Archived — {itemId} | {ItemName}"
```

---

## ERROR HANDLING (all operations)

```
function notionCall(operation, payload):
  try:
    response = fetch(notion_url, payload)
    if response.status == 200: return success
    if response.status == 400: return "❌ Bad payload — check property types"
    if response.status == 401: return "❌ Auth failed — check NOTION_API_KEY"
    if response.status == 404: return "❌ Database not found — check NOTION_DATABASE_ID"
    if response.status == 409: return "❌ Conflict — record may already exist"
  catch network_error:
    return "❌ Network error — check Notion API status"
```

---

## NOTES FOR CODING AGENT
- itemId is title type — must use "title" key not "rich_text"
- All text fields require the nested array format: [{text:{content:""}}]
- Ext_Price must always be recomputed in code — never trust stored value
- For UPDATE, always fetch page_id first — never hardcode it
- Never call DELETE without user confirmation
- Archived pages are excluded from default FETCH queries
