import json

from sqlalchemy.orm import Session

from app.db.models import Prompt
from app.schemas.prompt import StructuredPrompt


def create(
    session: Session, *, structured_prompt: StructuredPrompt, assembled_text: str, edited_by_user: bool = False
) -> Prompt:
    prompt = Prompt(
        structured_prompt_json=structured_prompt.model_dump_json(),
        assembled_text=assembled_text,
        negative_prompt_json=json.dumps(structured_prompt.negative_prompt),
        edited_by_user=1 if edited_by_user else 0,
    )
    session.add(prompt)
    session.flush()
    return prompt


def get(session: Session, prompt_id: int) -> Prompt | None:
    return session.get(Prompt, prompt_id)
