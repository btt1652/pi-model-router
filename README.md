# pi-model-router

OpenRouter free model picker — ranks free models by capability for Pi coding agent.

## Installation

### From Git

```
pi install git:https://github.com/btt1652/pi-model-router.git#main
```

### From npm (when published)

```
pi install pi-model-router
```

## Commands

### `free-model-select`

Shows the ranked list of free models and prompts you to pick one. The selected model becomes the active model for your current session.

```
free-model-select
```

### `openrouter-free-models-list`

Queries the OpenRouter API for free models, scores them by popularity and benchmark indices (coding, intelligence, agentic), and displays the top 15 ranked models.

## Output Format

| Column | Description |
|--------|-------------|
| Rank | Position in ranking |
| Model | Model ID |
| Ctx | Context window length |
| Cod | Coding index (Artificial Analysis) |
| Int | Intelligence index |
| Agt | Agentic index |
| Created | Release date |
| Expires | Expiration date |
| In:Out | Input/output modalities |
