"""
assignment.py — EngagePro Assistant with Intake & Logging
---------------------------------------------------------
- Step 1: Collect user's **name**, **email**, and **problem statement**.
- Step 2: Launch chat (natural tone, no citations, no sidebar).
- Every chat turn is shown and persisted in session_state.
- Intake entries are logged to both CSV and JSONL in the app folder:
    - intake_log.csv
    - intake_log.jsonl

Environment settings (set via main.py or OS):
  ENABLE_WIKI=1|0    RETRIEVER_K=<int>    OPENAI_CHAT_MODEL=...   OPENAI_EMBED_MODEL=...

Run:
  poetry run streamlit run assignment.py
"""
import os
import re
import csv
import json
import pickle
from datetime import datetime
from typing import List

import numpy as np
import streamlit as st
import wikipedia
import config

from langchain_community.document_loaders import PyPDFLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.embeddings.base import Embeddings
from langchain.schema import SystemMessage, HumanMessage

# ---------------- Embedding adapter ----------------
class EmbedAdapter(Embeddings):
    def __init__(self, inner):
        self.inner = inner
    def embed_documents(self, texts: List[str]):
        if hasattr(self.inner, "embed_documents"):
            return self.inner.embed_documents(texts)
        if hasattr(self.inner, "encode"):
            return self.inner.encode(texts, convert_to_numpy=True, normalize_embeddings=True).tolist()
        raise AttributeError("Embedding object lacks embed_documents/encode")
    def embed_query(self, text: str):
        if hasattr(self.inner, "embed_query"):
            return self.inner.embed_query(text)
        if hasattr(self.inner, "encode"):
            return self.inner.encode([text], convert_to_numpy=True, normalize_embeddings=True)[0].tolist()
        raise AttributeError("Embedding object lacks embed_query/encode")

embedder = EmbedAdapter(getattr(config, "hf_embeddings"))

# ---------------- Paths & settings ----------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INDEX_PKL = os.path.join(BASE_DIR, "engagepro_index.pkl")
FAISS_DIR = os.path.join(BASE_DIR, "engagepro_faiss")
BROCHURE_PDF = os.path.join(BASE_DIR, "Company_Brochure.pdf")
CSV_LOG = os.path.join(BASE_DIR, "intake_log.csv")
JSONL_LOG = os.path.join(BASE_DIR, "intake_log.jsonl")

USE_WIKI = os.getenv("ENABLE_WIKI", "1").strip().lower() in {"1","true","yes","on"}
TOP_K = int(os.getenv("RETRIEVER_K", "3"))

# ---------------- Vector stores ----------------
_FAISS_AVAILABLE = True
try:
    from langchain_community.vectorstores import FAISS
except Exception:
    _FAISS_AVAILABLE = False

class SimpleVectorStore:
    """Tiny cosine-sim vector store used if FAISS is missing."""
    def __init__(self, embeddings: Embeddings):
        self.embeddings = embeddings
        self.texts: List[str] = []
        self.metas: List[dict] = []
        self.vectors = None
    @classmethod
    def from_texts(cls, texts: List[str], metadatas: List[dict], embeddings: Embeddings):
        inst = cls(embeddings)
        inst.texts = texts
        inst.metas = metadatas
        vecs = embeddings.embed_documents(texts)
        arr = np.asarray(vecs, dtype=np.float32)
        arr = arr / (np.linalg.norm(arr, axis=1, keepdims=True) + 1e-12)
        inst.vectors = arr
        return inst
    def search(self, query: str, k: int = 3):
        from langchain_community.docstore.document import Document
        q = np.asarray(self.embeddings.embed_query(query), dtype=np.float32)
        q = q / (np.linalg.norm(q) + 1e-12)
        sims = (self.vectors @ q).reshape(-1)
        idx = sims.argsort()[::-1][:k]
        return [Document(page_content=self.texts[i], metadata=self.metas[i]) for i in idx]

# ---------------- Load / build vector store ----------------
@st.cache_resource(show_spinner=True)
def load_vectorstore():
    if os.path.exists(INDEX_PKL):
        with open(INDEX_PKL, "rb") as f:
            return pickle.load(f)
    if _FAISS_AVAILABLE and os.path.exists(FAISS_DIR):
        return FAISS.load_local(FAISS_DIR, embedder, allow_dangerous_deserialization=True)
    if os.path.exists(BROCHURE_PDF):
        try:
            docs = PyPDFLoader(BROCHURE_PDF).load()
            chunks = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=120).split_documents(docs)
            texts = [c.page_content for c in chunks]
            metas = [c.metadata for c in chunks]
            if _FAISS_AVAILABLE:
                return FAISS.from_texts(texts, embedder, metadatas=metas)
            else:
                return SimpleVectorStore.from_texts(texts, metas, embedder)
        except Exception as e:
            st.error(f"Failed to build index from brochure: {e}")
            return None
    st.error("No index or brochure PDF found. Put Company_Brochure.pdf next to assignment.py or build with main.py.")
    return None

# ---------------- Prompting ----------------
SYSTEM_INSTRUCTIONS = (
    "You are EngagePro Assistant. Speak in a natural, friendly, and professional tone. "
    "Answer directly—no filler like 'Based on the context provided' or 'According to the document'. "
    "Use the context to craft a clear, human-sounding response. If context is missing, say so briefly."
)

def run_rag_answer(q: str, docs: List):
    context = "\n\n".join(d.page_content for d in docs)
    messages = [
        SystemMessage(content=SYSTEM_INSTRUCTIONS),
        HumanMessage(content=f"Context:\n{context}\n\nQuestion:\n{q}\n\nGive a concise, natural answer without citations."),
    ]
    resp = config.llm_openai.invoke(messages)
    return (getattr(resp, "content", "") or "").strip()

# ---------------- Intake helpers ----------------
def valid_email(email: str) -> bool:
    import re as _re
    return bool(_re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email.strip()))

def append_intake_log(name: str, email: str, problem: str) -> None:
    ts = datetime.utcnow().isoformat() + "Z"
    row = {"timestamp": ts, "name": name, "email": email, "problem": problem}
    # CSV
    try:
        exists = os.path.exists(CSV_LOG)
        with open(CSV_LOG, "a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["timestamp", "name", "email", "problem"])
            if not exists:
                writer.writeheader()
            writer.writerow(row)
    except Exception as e:
        st.warning(f"Could not write CSV log: {e}")
    # JSONL
    try:
        with open(JSONL_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except Exception as e:
        st.warning(f"Could not write JSONL log: {e}")

# ---------------- UI: Intake + Chat ----------------
st.set_page_config(page_title="EngagePro Assistant", page_icon="🤖", layout="wide")
st.title("💬 EngagePro Assistant")

if "intake_done" not in st.session_state:
    st.session_state["intake_done"] = False

with st.container():
    if not st.session_state["intake_done"]:
        st.subheader("Tell me a bit about you to get started")
        with st.form("intake"):
            name = st.text_input("Name", placeholder="Jane Doe")
            email = st.text_input("Email", placeholder="jane@example.com")
            problem = st.text_area("What’s your problem statement?", placeholder="Briefly describe what you want to achieve or solve…", height=140)
            col1, col2 = st.columns([1,1])
            with col1:
                submitted = st.form_submit_button("Start chat")
            with col2:
                clear = st.form_submit_button("Clear")
        if submitted:
            errors = []
            if not name.strip(): errors.append("Please enter your name.")
            if not valid_email(email): errors.append("Please enter a valid email address.")
            if not problem.strip(): errors.append("Please add a brief problem statement.")
            if errors:
                for e in errors:
                    st.error(e)
            else:
                st.session_state["user_name"] = name.strip()
                st.session_state["user_email"] = email.strip()
                st.session_state["user_problem"] = problem.strip()
                # Log intake to CSV/JSONL
                append_intake_log(st.session_state["user_name"], st.session_state["user_email"], st.session_state["user_problem"])
                st.session_state["intake_done"] = True
                st.session_state["messages"] = [
                    {"role": "assistant", "content": f"Hi {st.session_state['user_name']}, thanks for sharing. I’ve noted your email ({st.session_state['user_email']}). Let’s work on this: {st.session_state['user_problem']}"}
                ]
                st.rerun()
        elif clear:
            for k in list(st.session_state.keys()):
                del st.session_state[k]
            st.rerun()

# Vector store prepared early so the chat uses it promptly
vs = load_vectorstore()

def retrieve(vstore, q: str, k: int):
    if vstore is None: return []
    if hasattr(vstore, "as_retriever"):
        try:
            return vstore.as_retriever(search_kwargs={"k": k}).get_relevant_documents(q)
        except TypeError:
            return vstore.as_retriever(k=k).get_relevant_documents(q)
    if hasattr(vstore, "search"):
        return vstore.search(q, k=k)
    return []

if st.session_state["intake_done"]:
    # header with intake summary + reset
    with st.container():
        st.caption(f"Signed in as **{st.session_state['user_name']}**  ·  {st.session_state['user_email']}")
        st.caption(f"Problem: {st.session_state['user_problem']}")
        st.button("Restart intake", on_click=lambda: (st.session_state.clear(), st.rerun()))

    # show history
    for msg in st.session_state.get("messages", []):
        with st.chat_message(msg["role"]):
            st.markdown(msg["content"])

    # input
    q = st.chat_input("Type your question…")
    if q:
        st.session_state["messages"].append({"role": "user", "content": q})
        with st.chat_message("user"):
            st.markdown(q)

        # assistant turn
        docs = retrieve(vs, q, TOP_K)
        if docs:
            try:
                reply = run_rag_answer(q, docs)
            except Exception as e:
                reply = f"Sorry, I ran into an error generating the answer ({e})."
        else:
            if USE_WIKI:
                try:
                    titles = wikipedia.search(q, results=1)
                    if titles:
                        reply = wikipedia.summary(titles[0], sentences=2)
                    else:
                        reply = "I couldn't find enough context to answer that."
                except Exception:
                    reply = "I couldn't find enough context to answer that."
            else:
                reply = "I couldn't find enough context to answer that."

        with st.chat_message("assistant"):
            st.markdown(reply)
        st.session_state["messages"].append({"role": "assistant", "content": reply})
