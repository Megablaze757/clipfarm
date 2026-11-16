"""Prints ~30 minutes of podcast-style sentences for espeak-ng (benchmark speech)."""
import random

random.seed(7)
subj = ["Most founders", "Nobody", "The best creators", "Every team I know", "My first company",
        "This one habit", "The algorithm", "Your audience"]
verb = ["gets pricing wrong", "never talks about this", "quietly ignores retention", "spends too much on ads",
        "doubled revenue in a year", "fails without feedback", "rewards the first three seconds",
        "remembers stories, not facts"]
tail = ["and here is why.", "because nobody tested it.", "which sounds crazy, right?", "and it changed everything.",
        "so we tried something else.", "but the data says otherwise.", "and that is the whole secret.",
        "until we fixed one thing."]
print(" ".join(f"{random.choice(subj)} {random.choice(verb)}, {random.choice(tail)}" for _ in range(420)))
