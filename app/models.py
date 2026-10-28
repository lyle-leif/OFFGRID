from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.config import MAX_QUESTION_CHARS

FacilityType = Literal[
    "evacuation_center", "hospital", "health_center", "rescue", "police", "fire_station",
    "pharmacy", "town_hall", "barangay_hall", "market", "drinking_water", "relief_point",
]


class Location(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9-]{1,64}$")
    name: str
    type: FacilityType
    # Other roles of the same place, e.g. an evacuation center that is also a hospital.
    also: list[FacilityType] = []
    address: str | None = None
    description: str | None = None
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    phone: str | None = None
    opening_hours: str | None = None
    website: str | None = None
    osm_url: str | None = None
    source: str | None = None
    verified_on: str | None = None
    is_sample: bool = False


class Previous(BaseModel):
    """The last question and answer, so follow-up questions keep their topic."""

    question: str = Field(max_length=MAX_QUESTION_CHARS)
    answer: str = Field(max_length=4000)


class Position(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=MAX_QUESTION_CHARS)
    location_id: str | None = Field(default=None, max_length=64)
    previous: Previous | None = None
    # The user's position (set on the map or from GPS) and travel mode, for direction questions.
    from_pos: Position | None = None
    travel_mode: Literal["walk", "drive"] = "walk"
    # Battery saver sends False: answer with the guide text only, no AI summary.
    use_ai: bool = True
    # Interface language: the app's own sentences (place, report and route answers) use it.
    lang: Literal["en", "tl"] = "en"

    @field_validator("question")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("question must not be blank")
        return v


ReportKind = Literal[
    "road_flooded", "road_blocked", "center_full", "center_open", "water_available", "power_out", "medical_need",
    "other",
]
# Random ids made on the phone: the report id (so a retried post isn't stored twice) and
# an anonymous device id (so a phone votes once per report).
TOKEN = r"^[A-Za-z0-9-]{8,64}$"


class NewReport(BaseModel):
    id: str = Field(pattern=TOKEN)
    kind: ReportKind
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    location_id: str | None = Field(default=None, max_length=64)
    device: str = Field(pattern=TOKEN)
    # Seconds since the phone made the report (non-zero when it was queued offline).
    age_s: float = Field(default=0, ge=0, le=7 * 86400)
    # Reports v2: one-tap details (data/report_details.json), the reporter's own words (cleaned
    # by app/services/report_notes.py), and whether they marked it by GPS on site.
    details: list[str] = Field(default_factory=list, max_length=4)
    note: str | None = Field(default=None, max_length=1000)
    on_site: bool = False
    acc_bucket: Literal[20, 50] | None = None


class NoteAction(BaseModel):
    """A responder approves a note (the public may read it) or hides it."""

    action: Literal["approve", "hide"]


class ReportVote(BaseModel):
    device: str = Field(pattern=TOKEN)
    vote: Literal["confirm", "dispute"]


class ResponderLogin(BaseModel):
    pin: str = Field(max_length=32)


class Source(BaseModel):
    doc: str
    chunk_id: str
    title: str
    excerpt: str
