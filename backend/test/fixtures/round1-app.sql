PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'teacher',
      created_at TEXT NOT NULL
    );
INSERT INTO users VALUES(1,'teacher@ctquest.local','scrypt$eead9b7e9913b6c7015b6bb070cc3025$e9f367a8b593f5a0d253cfa8941770e5b916b8c15a415f81fb87e4c121c1686a3a219cd85b33f6473f423b324fd68c2a68e612791af9e268f26d199ff89a9e28','teacher','2026-09-27T01:59:55.154Z');
CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      join_code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      selection_mode TEXT NOT NULL DEFAULT 'ALL',
      duration_minutes INTEGER,
      start_at TEXT,
      end_at TEXT,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL, filter_json TEXT,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
INSERT INTO events VALUES(1,'CT Quest Demo Event','DEMO123','active','ALL',45,NULL,NULL,1,'2026-09-27T01:59:55.162Z',NULL);
INSERT INTO events VALUES(2,'P6 Round','P6RND','active','P6',20,NULL,NULL,1,'2026-09-27T02:00:01.904Z',NULL);
INSERT INTO events VALUES(3,'Round 1 RGS','R1RGS','active','FILTER',NULL,NULL,NULL,1,'2026-09-27T02:35:21.858Z','{"audiences":["rgsynapse"],"levels":["S1"]}');
CREATE TABLE event_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      question_id TEXT NOT NULL,
      question_order INTEGER NOT NULL,
      question_json TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
INSERT INTO event_questions VALUES(1,1,'P5-01',0,'{"id":"P5-01","level":"P5","topic":"Sequencing","qType":"Order / process","details":"Tests reasoning about step order and constraints (can’t close box before inserting items).","title":"Packing order","points":3,"prompt":"A robot packs a snack box.\n\nSteps available:\n1) Put the sandwich into the box\n2) Close the box\n3) Put the note into the box\n\nWhich order always works?","options":["1, 2, 3","3, 2, 1","2, 1, 3","1, 3, 2"],"type":"mcq","audience":"core","answer":{"index":3}}');
INSERT INTO event_questions VALUES(2,1,'P5-02',1,'{"id":"P5-02","level":"P5","topic":"Patterns","qType":"Next in sequence","details":"Finds a repeating pattern and predicts a later position.","title":"Sticker pattern","points":3,"prompt":"A sticker machine prints this pattern repeatedly:\n\nCircle, Circle, Square, Circle, Circle, Square, ...\n\nWhat is the 9th sticker?","options":["Circle","Square","Triangle","It cannot be known"],"type":"mcq","audience":"core","answer":{"index":1}}');
INSERT INTO event_questions VALUES(3,1,'P5-03',2,'{"id":"P5-03","level":"P5","topic":"Logic","qType":"If rule","details":"Applies a simple if/otherwise rule carefully.","title":"Ticket rule","points":3,"prompt":"A game gives a ticket based on the number you roll:\nIf the number is 1 or 2, you get a BLUE ticket.\nOtherwise, you get a RED ticket.\n\nYou roll a 4. What ticket do you get?","options":["BLUE","RED","Both","None"],"type":"mcq","audience":"core","answer":{"index":1}}');
INSERT INTO event_questions VALUES(4,1,'P5-04',3,'{"id":"P5-04","level":"P5","topic":"Spatial reasoning","qType":"Rotation","details":"Mentally rotates an object by 90° steps.","title":"Turn the arrow","points":3,"prompt":"An arrow points UP. You turn it right (clockwise) twice.\n\nWhere does it point now?","options":["Up","Down","Left","Right"],"type":"mcq","audience":"core","answer":{"index":1}}');
INSERT INTO event_questions VALUES(5,1,'P5-05',4,'{"id":"P5-05","level":"P5","topic":"Information","qType":"Counting states","details":"Counts how many outcomes exist for multiple ON/OFF choices.","title":"Light switches","points":3,"prompt":"You have 3 light switches. Each switch can be ON or OFF.\n\nHow many different switch patterns are possible?","options":["3","6","8","9"],"type":"mcq","audience":"core","answer":{"index":2}}');
INSERT INTO event_questions VALUES(6,1,'P6-01',5,'{"id":"P6-01","level":"P6","topic":"Grids / paths","qType":"Shortest path","details":"Finds a shortest path length on a grid while avoiding obstacles.","title":"Shortest safe walk","points":4,"prompt":"You are at S and want to reach T.\nYou can move up/down/left/right.\nYou cannot step on #.\n\n","art":"S . . .\n# # . #\n. . . #\n. # . T","options":["6 steps","7 steps","8 steps","9 steps"],"type":"mcq","audience":"core","answer":{"index":0}}');
INSERT INTO event_questions VALUES(7,1,'P6-02',6,'{"id":"P6-02","level":"P6","topic":"Loops","qType":"Repeated action","details":"Simulates a loop and computes the final total.","title":"Stamping cards","points":4,"prompt":"A machine starts at 0 points.\nIt repeats 5 times:\nAdd 2 points.\n\nHow many points at the end?","options":["7","8","9","10"],"type":"mcq","audience":"core","answer":{"index":3}}');
INSERT INTO event_questions VALUES(8,1,'P6-03',7,'{"id":"P6-03","level":"P6","topic":"Sorting","qType":"Minimum swaps (adjacent)","details":"Counts the minimum neighbouring swaps needed to sort (inversions).","title":"Neighbour swaps","points":4,"prompt":"You have: 2 4 1 3\nYou may swap only neighbouring numbers.\n\nMinimum swaps to sort into 1 2 3 4?","options":["2","3","4","5"],"type":"mcq","audience":"core","answer":{"index":1}}');
INSERT INTO event_questions VALUES(9,1,'P6-04',8,'{"id":"P6-04","level":"P6","topic":"Conditions","qType":"Rule with priority","details":"Special-case rule overrides normal scoring.","title":"Bonus points","points":4,"prompt":"A quiz gives points like this:\n- Correct answer: +2\n- Extra bonus: If you answer correctly AND in under 10 seconds, you get +5 total (not +2).\n\nYou answer correctly in 8 seconds. How many points do you get?","options":["2","5","7","10"],"type":"mcq","audience":"core","answer":{"index":1}}');
INSERT INTO event_questions VALUES(10,1,'P6-05',9,'{"id":"P6-05","level":"P6","topic":"Networks","qType":"Count shortest routes","details":"Counts distinct shortest routes in a small network.","title":"Two-step routes","points":4,"prompt":"A can connect to B and C.\nB can connect to D.\nC can connect to D.\n\nHow many different shortest routes are there from A to D?","options":["1","2","3","4"],"type":"mcq","audience":"core","answer":{"index":1}}');
INSERT INTO event_questions VALUES(11,1,'S1-01',10,'{"id":"S1-01","level":"S1","topic":"Debugging","qType":"Edge case / equality","details":"Tests understanding of comparisons when values are equal.","title":"Pick the larger number","points":5,"prompt":"A student writes this rule to return the larger of A and B:\n\nIf A > B, return A\nElse return B\n\nWhen A = 3 and B = 3, which line runs?","options":["The first line runs and returns A","The Else line runs and returns B","It crashes","It returns nothing"],"type":"mcq","audience":"core","answer":{"index":1}}');
INSERT INTO event_questions VALUES(12,1,'S1-02',11,'{"id":"S1-02","level":"S1","topic":"Binary","qType":"Bit counting","details":"Uses 2^n outcomes for n bits.","title":"How many codes?","points":5,"prompt":"A locker code uses exactly 4 bits (0/1).\n\nHow many different codes are possible?","options":["4","8","12","16"],"type":"mcq","audience":"core","answer":{"index":3}}');
INSERT INTO event_questions VALUES(13,1,'S1-03',12,'{"id":"S1-03","level":"S1","topic":"Algorithms","qType":"Trace a procedure","details":"Traces a branching procedure across fixed iterations.","title":"Even-odd machine","points":5,"prompt":"Start with the number 10.\nRepeat exactly 3 times:\n- If the number is even, divide by 2\n- If the number is odd, add 3\n\nWhat is the final number?","options":["4","5","6","7"],"type":"mcq","audience":"core","answer":{"index":0}}');
INSERT INTO event_questions VALUES(14,1,'S1-04',13,'{"id":"S1-04","level":"S1","topic":"Data representation","qType":"Encoding size","details":"Computes bits needed: pixels × bits per pixel.","title":"Pixel storage","points":5,"prompt":"A 5×5 black/white image uses 1 bit per pixel.\n\nHow many bits are needed in total?","options":["10","15","20","25"],"type":"mcq","audience":"core","answer":{"index":3}}');
INSERT INTO event_questions VALUES(15,1,'S1-05',14,'{"id":"S1-05","level":"S1","topic":"Logic","qType":"OR condition","details":"Understands OR: either condition is enough.","title":"Club entry rule","points":5,"prompt":"A club rule says:\nYou may enter if you have a PASS OR you are with a TEACHER.\n\nYou have no pass, but you are with a teacher.\nCan you enter?","options":["Yes","No","Only on weekends","Not enough information"],"type":"mcq","audience":"core","answer":{"index":0}}');
INSERT INTO event_questions VALUES(16,1,'S2-01',15,'{"id":"S2-01","level":"S2","topic":"Efficiency","qType":"Compare strategies","details":"Chooses strategy with fewer checks in the worst case (binary search idea).","title":"Finding a name","points":6,"prompt":"A list has 100 names.\nStrategy A: start from the top and check one by one.\nStrategy B: the list is sorted, so you can repeatedly check the middle and cut the list in half.\n\nIn the worst case, which strategy uses fewer checks?","options":["A","B","Same","Cannot compare"],"type":"mcq","audience":"core","answer":{"index":1}}');
INSERT INTO event_questions VALUES(17,1,'S2-02',16,'{"id":"S2-02","level":"S2","topic":"Graphs / routing","qType":"Cheapest path (weighted)","details":"Finds minimum total cost, not minimum number of steps.","title":"Cheapest route","points":6,"prompt":"A delivery bot can travel these paths (cost in minutes):\nA→B (2), A→C (5), B→D (6), C→D (1), B→C (1)\n\nWhat is the cheapest cost from A to D?","options":["4","6","7","8"],"type":"mcq","audience":"core","answer":{"index":0}}');
INSERT INTO event_questions VALUES(18,1,'S2-03',17,'{"id":"S2-03","level":"S2","topic":"Invariants","qType":"Parity / impossible state","details":"Flipping 2 tiles keeps number of black tiles even.","title":"Colour flips","points":6,"prompt":"You have 6 tiles in a row, all WHITE.\nOne move flips exactly 2 neighbouring tiles (WHITE↔BLACK).\n\nAfter any number of moves, which situation is impossible?","options":["0 black tiles","1 black tile","2 black tiles","4 black tiles"],"type":"mcq","audience":"core","answer":{"index":1}}');
INSERT INTO event_questions VALUES(19,1,'S2-04',18,'{"id":"S2-04","level":"S2","topic":"Strings","qType":"Pattern matching (overlaps)","details":"Counts substring occurrences allowing overlaps.","title":"Counting blocks","points":6,"prompt":"A code is: ABABABAA\n\nHow many times does the block ''ABA'' appear if overlaps ARE allowed?","options":["1","2","3","4"],"type":"mcq","audience":"core","answer":{"index":2}}');
INSERT INTO event_questions VALUES(20,1,'S2-05',19,'{"id":"S2-05","level":"S2","topic":"Cryptography basics","qType":"Caesar shift decode","details":"Decodes by shifting letters backward by 3.","title":"Shift message","points":6,"prompt":"A message uses this rule:\nA→D, B→E, C→F, ... (each letter shifts forward by 3)\n\nThe coded word is: KHOOR\nWhat is the original word?","options":["HELLO","KELLY","HOLLY","KHOOR"],"type":"mcq","audience":"core","answer":{"index":0}}');
INSERT INTO event_questions VALUES(21,2,'P6-01',0,'{"id":"P6-01","level":"P6","topic":"Grids / paths","qType":"Shortest path","details":"Finds a shortest path length on a grid while avoiding obstacles.","title":"Shortest safe walk","points":4,"prompt":"You are at S and want to reach T.\nYou can move up/down/left/right.\nYou cannot step on #.\n\n","art":"S . . .\n# # . #\n. . . #\n. # . T","options":["6 steps","7 steps","8 steps","9 steps"],"type":"mcq","audience":"core","answer":{"index":0}}');
INSERT INTO event_questions VALUES(22,2,'P6-02',1,'{"id":"P6-02","level":"P6","topic":"Loops","qType":"Repeated action","details":"Simulates a loop and computes the final total.","title":"Stamping cards","points":4,"prompt":"A machine starts at 0 points.\nIt repeats 5 times:\nAdd 2 points.\n\nHow many points at the end?","options":["7","8","9","10"],"type":"mcq","audience":"core","answer":{"index":3}}');
INSERT INTO event_questions VALUES(23,2,'P6-03',2,'{"id":"P6-03","level":"P6","topic":"Sorting","qType":"Minimum swaps (adjacent)","details":"Counts the minimum neighbouring swaps needed to sort (inversions).","title":"Neighbour swaps","points":4,"prompt":"You have: 2 4 1 3\nYou may swap only neighbouring numbers.\n\nMinimum swaps to sort into 1 2 3 4?","options":["2","3","4","5"],"type":"mcq","audience":"core","answer":{"index":1}}');
INSERT INTO event_questions VALUES(24,2,'P6-04',3,'{"id":"P6-04","level":"P6","topic":"Conditions","qType":"Rule with priority","details":"Special-case rule overrides normal scoring.","title":"Bonus points","points":4,"prompt":"A quiz gives points like this:\n- Correct answer: +2\n- Extra bonus: If you answer correctly AND in under 10 seconds, you get +5 total (not +2).\n\nYou answer correctly in 8 seconds. How many points do you get?","options":["2","5","7","10"],"type":"mcq","audience":"core","answer":{"index":1}}');
INSERT INTO event_questions VALUES(25,2,'P6-05',4,'{"id":"P6-05","level":"P6","topic":"Networks","qType":"Count shortest routes","details":"Counts distinct shortest routes in a small network.","title":"Two-step routes","points":4,"prompt":"A can connect to B and C.\nB can connect to D.\nC can connect to D.\n\nHow many different shortest routes are there from A to D?","options":["1","2","3","4"],"type":"mcq","audience":"core","answer":{"index":1}}');
INSERT INTO event_questions VALUES(26,3,'RGS-S1-01',0,'{"id":"RGS-S1-01","type":"mcq","audience":"rgsynapse","level":"S1","title":"Odd and even totals","prompt":"What does this Python program print?","code":{"language":"python","source":"total = 0\nfor i in range(1, 6):\n    if i % 2 == 0:\n        total += i\n    else:\n        total -= 1\nprint(total)"},"options":["3","5","6","9"],"answer":{"index":0},"points":5,"difficulty":3,"ontology":["concept.loops","concept.conditionals","concept.data.variables","practice.testing-debugging.tracing"],"outcomes":["LO-CODE-TRACE-1"],"crosswalk":{"bebrasCategory":"algorithms-programming"},"topic":"Code tracing","qType":"Predict the output","details":"Traces a loop with a branch inside it, including where range() stops.","bank":"rgsynapse"}');
INSERT INTO event_questions VALUES(27,3,'RGS-S1-02',1,'{"id":"RGS-S1-02","type":"mcq","audience":"rgsynapse","level":"S1","title":"Checking the AI''s answer","prompt":"You asked an AI assistant for a Python function that returns the largest number in a list. It wrote the code below.\n\nWhich test input shows that the function has a bug?","code":{"language":"python","source":"def largest(nums):\n    best = 0\n    for n in nums:\n        if n > best:\n            best = n\n    return best"},"options":["[3, 8, 2]","[5]","[-4, -2, -7]","[1, 1, 1]"],"answer":{"index":2},"points":5,"difficulty":3,"ontology":["practice.testing-debugging.reviewing-ai-code","practice.testing-debugging.edge-cases","concept.data.variables"],"outcomes":["LO-AI-REVIEW-1","LO-DEBUG-1"],"crosswalk":{"bebrasCategory":"algorithms-programming"},"topic":"Reviewing AI code","qType":"Find the failing input","details":"Chooses a test case that exposes a wrong starting value.","bank":"rgsynapse"}');
CREATE TABLE attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      student_name TEXT NOT NULL,
      student_group TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'started',
      started_at TEXT NOT NULL,
      submitted_at TEXT,
      score INTEGER,
      max_score INTEGER, token_hash TEXT, deadline_at TEXT,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
INSERT INTO attempts VALUES(1,1,'Ada','S1-2','submitted','2026-09-27T02:00:01.842Z','2026-09-27T02:00:01.851Z',16,90,NULL,'2026-09-27T02:45:01.842Z');
INSERT INTO attempts VALUES(2,1,'Grace','S2-1','started','2026-09-27T02:00:01.853Z',NULL,NULL,NULL,NULL,'2026-09-27T02:45:01.853Z');
INSERT INTO attempts VALUES(3,1,'Chen','S1-3','submitted','2026-09-27T02:00:01.855Z','2026-09-27T02:00:01.858Z',15,90,NULL,'2026-09-27T02:45:01.855Z');
INSERT INTO attempts VALUES(4,1,'Dev','S2-4','submitted','2026-09-27T02:00:01.861Z','2026-09-27T02:00:01.864Z',3,90,NULL,'2026-09-27T02:45:01.861Z');
INSERT INTO attempts VALUES(5,1,'Rin','S2-2','submitted','2026-09-27T02:35:21.730Z','2026-09-27T02:35:21.743Z',15,90,'e60e83f73e9942e5de1d3083280d4dbdd2dfd622f37c278822874de350261d3b','2026-09-27T03:20:21.730Z');
INSERT INTO attempts VALUES(6,3,'Sam','S1-4','submitted','2026-09-27T02:35:21.865Z','2026-09-27T02:35:21.869Z',5,10,'f4b8f0e9cc2ee4f6aad80c35f6e6c230a547c35937c82ce6c44e3821c266200d',NULL);
CREATE TABLE IF NOT EXISTS "answers" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attempt_id INTEGER NOT NULL,
        question_id TEXT NOT NULL,
        question_type TEXT NOT NULL DEFAULT 'mcq',
        response_json TEXT,
        chosen_index INTEGER,
        correct_index INTEGER,
        earned_points INTEGER NOT NULL,
        max_points INTEGER NOT NULL,
        score_status TEXT NOT NULL DEFAULT 'scored',
        FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE
      );
INSERT INTO answers VALUES(1,1,'P5-01','mcq','3',3,3,3,3,'scored');
INSERT INTO answers VALUES(2,1,'P5-02','mcq','1',1,1,3,3,'scored');
INSERT INTO answers VALUES(3,1,'P5-03','mcq','null',NULL,1,0,3,'scored');
INSERT INTO answers VALUES(4,1,'P5-04','mcq','null',NULL,1,0,3,'scored');
INSERT INTO answers VALUES(5,1,'P5-05','mcq','null',NULL,2,0,3,'scored');
INSERT INTO answers VALUES(6,1,'P6-01','mcq','1',1,1,4,4,'scored');
INSERT INTO answers VALUES(7,1,'P6-02','mcq','null',NULL,3,0,4,'scored');
INSERT INTO answers VALUES(8,1,'P6-03','mcq','null',NULL,1,0,4,'scored');
INSERT INTO answers VALUES(9,1,'P6-04','mcq','null',NULL,1,0,4,'scored');
INSERT INTO answers VALUES(10,1,'P6-05','mcq','null',NULL,1,0,4,'scored');
INSERT INTO answers VALUES(11,1,'S1-01','mcq','null',NULL,1,0,5,'scored');
INSERT INTO answers VALUES(12,1,'S1-02','mcq','null',NULL,3,0,5,'scored');
INSERT INTO answers VALUES(13,1,'S1-03','mcq','null',NULL,0,0,5,'scored');
INSERT INTO answers VALUES(14,1,'S1-04','mcq','null',NULL,3,0,5,'scored');
INSERT INTO answers VALUES(15,1,'S1-05','mcq','null',NULL,0,0,5,'scored');
INSERT INTO answers VALUES(16,1,'S2-01','mcq','null',NULL,1,0,6,'scored');
INSERT INTO answers VALUES(17,1,'S2-02','mcq','2',2,2,6,6,'scored');
INSERT INTO answers VALUES(18,1,'S2-03','mcq','null',NULL,1,0,6,'scored');
INSERT INTO answers VALUES(19,1,'S2-04','mcq','null',NULL,2,0,6,'scored');
INSERT INTO answers VALUES(20,1,'S2-05','mcq','null',NULL,0,0,6,'scored');
INSERT INTO answers VALUES(21,3,'P5-01','mcq','1',1,3,0,3,'scored');
INSERT INTO answers VALUES(22,3,'P5-02','mcq','null',NULL,1,0,3,'scored');
INSERT INTO answers VALUES(23,3,'P5-03','mcq','null',NULL,1,0,3,'scored');
INSERT INTO answers VALUES(24,3,'P5-04','mcq','null',NULL,1,0,3,'scored');
INSERT INTO answers VALUES(25,3,'P5-05','mcq','null',NULL,2,0,3,'scored');
INSERT INTO answers VALUES(26,3,'P6-01','mcq','1',1,1,4,4,'scored');
INSERT INTO answers VALUES(27,3,'P6-02','mcq','null',NULL,3,0,4,'scored');
INSERT INTO answers VALUES(28,3,'P6-03','mcq','null',NULL,1,0,4,'scored');
INSERT INTO answers VALUES(29,3,'P6-04','mcq','null',NULL,1,0,4,'scored');
INSERT INTO answers VALUES(30,3,'P6-05','mcq','null',NULL,1,0,4,'scored');
INSERT INTO answers VALUES(31,3,'S1-01','mcq','1',1,1,5,5,'scored');
INSERT INTO answers VALUES(32,3,'S1-02','mcq','null',NULL,3,0,5,'scored');
INSERT INTO answers VALUES(33,3,'S1-03','mcq','null',NULL,0,0,5,'scored');
INSERT INTO answers VALUES(34,3,'S1-04','mcq','null',NULL,3,0,5,'scored');
INSERT INTO answers VALUES(35,3,'S1-05','mcq','null',NULL,0,0,5,'scored');
INSERT INTO answers VALUES(36,3,'S2-01','mcq','null',NULL,1,0,6,'scored');
INSERT INTO answers VALUES(37,3,'S2-02','mcq','2',2,2,6,6,'scored');
INSERT INTO answers VALUES(38,3,'S2-03','mcq','null',NULL,1,0,6,'scored');
INSERT INTO answers VALUES(39,3,'S2-04','mcq','null',NULL,2,0,6,'scored');
INSERT INTO answers VALUES(40,3,'S2-05','mcq','null',NULL,0,0,6,'scored');
INSERT INTO answers VALUES(41,4,'P5-01','mcq','3',3,3,3,3,'scored');
INSERT INTO answers VALUES(42,4,'P5-02','mcq','null',NULL,1,0,3,'scored');
INSERT INTO answers VALUES(43,4,'P5-03','mcq','null',NULL,1,0,3,'scored');
INSERT INTO answers VALUES(44,4,'P5-04','mcq','null',NULL,1,0,3,'scored');
INSERT INTO answers VALUES(45,4,'P5-05','mcq','null',NULL,2,0,3,'scored');
INSERT INTO answers VALUES(46,4,'P6-01','mcq','0',0,1,0,4,'scored');
INSERT INTO answers VALUES(47,4,'P6-02','mcq','null',NULL,3,0,4,'scored');
INSERT INTO answers VALUES(48,4,'P6-03','mcq','null',NULL,1,0,4,'scored');
INSERT INTO answers VALUES(49,4,'P6-04','mcq','null',NULL,1,0,4,'scored');
INSERT INTO answers VALUES(50,4,'P6-05','mcq','null',NULL,1,0,4,'scored');
INSERT INTO answers VALUES(51,4,'S1-01','mcq','0',0,1,0,5,'scored');
INSERT INTO answers VALUES(52,4,'S1-02','mcq','null',NULL,3,0,5,'scored');
INSERT INTO answers VALUES(53,4,'S1-03','mcq','null',NULL,0,0,5,'scored');
INSERT INTO answers VALUES(54,4,'S1-04','mcq','null',NULL,3,0,5,'scored');
INSERT INTO answers VALUES(55,4,'S1-05','mcq','null',NULL,0,0,5,'scored');
INSERT INTO answers VALUES(56,4,'S2-01','mcq','null',NULL,1,0,6,'scored');
INSERT INTO answers VALUES(57,4,'S2-02','mcq','0',0,2,0,6,'scored');
INSERT INTO answers VALUES(58,4,'S2-03','mcq','null',NULL,1,0,6,'scored');
INSERT INTO answers VALUES(59,4,'S2-04','mcq','null',NULL,2,0,6,'scored');
INSERT INTO answers VALUES(60,4,'S2-05','mcq','null',NULL,0,0,6,'scored');
INSERT INTO answers VALUES(61,5,'P5-01','mcq','1',1,3,0,3,'scored');
INSERT INTO answers VALUES(62,5,'P5-02','mcq','null',NULL,1,0,3,'scored');
INSERT INTO answers VALUES(63,5,'P5-03','mcq','null',NULL,1,0,3,'scored');
INSERT INTO answers VALUES(64,5,'P5-04','mcq','null',NULL,1,0,3,'scored');
INSERT INTO answers VALUES(65,5,'P5-05','mcq','null',NULL,2,0,3,'scored');
INSERT INTO answers VALUES(66,5,'P6-01','mcq','0',0,0,4,4,'scored');
INSERT INTO answers VALUES(67,5,'P6-02','mcq','null',NULL,3,0,4,'scored');
INSERT INTO answers VALUES(68,5,'P6-03','mcq','null',NULL,1,0,4,'scored');
INSERT INTO answers VALUES(69,5,'P6-04','mcq','null',NULL,1,0,4,'scored');
INSERT INTO answers VALUES(70,5,'P6-05','mcq','null',NULL,1,0,4,'scored');
INSERT INTO answers VALUES(71,5,'S1-01','mcq','1',1,1,5,5,'scored');
INSERT INTO answers VALUES(72,5,'S1-02','mcq','null',NULL,3,0,5,'scored');
INSERT INTO answers VALUES(73,5,'S1-03','mcq','null',NULL,0,0,5,'scored');
INSERT INTO answers VALUES(74,5,'S1-04','mcq','null',NULL,3,0,5,'scored');
INSERT INTO answers VALUES(75,5,'S1-05','mcq','null',NULL,0,0,5,'scored');
INSERT INTO answers VALUES(76,5,'S2-01','mcq','null',NULL,1,0,6,'scored');
INSERT INTO answers VALUES(77,5,'S2-02','mcq','0',0,0,6,6,'scored');
INSERT INTO answers VALUES(78,5,'S2-03','mcq','null',NULL,1,0,6,'scored');
INSERT INTO answers VALUES(79,5,'S2-04','mcq','null',NULL,2,0,6,'scored');
INSERT INTO answers VALUES(80,5,'S2-05','mcq','null',NULL,0,0,6,'scored');
INSERT INTO answers VALUES(81,6,'RGS-S1-01','mcq','0',0,0,5,5,'scored');
INSERT INTO answers VALUES(82,6,'RGS-S1-02','mcq','null',NULL,2,0,5,'scored');
CREATE TABLE ontology_nodes (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        description TEXT,
        parent_id TEXT,
        sources_json TEXT NOT NULL DEFAULT '[]',
        position INTEGER NOT NULL
      );
INSERT INTO ontology_nodes VALUES('concept','concept','Computational concepts','Ideas that programs and algorithms are built from.',NULL,'[{"framework":"brennan-resnick-2012","term":"computational concepts"}]',0);
INSERT INTO ontology_nodes VALUES('concept.sequences','concept','Sequences','Steps carried out in a particular order, where order matters.','concept','[{"framework":"brennan-resnick-2012","term":"sequences"}]',1);
INSERT INTO ontology_nodes VALUES('concept.loops','concept','Loops','Running the same steps several times, a fixed number of times or until a condition holds.','concept','[{"framework":"brennan-resnick-2012","term":"loops"}]',2);
INSERT INTO ontology_nodes VALUES('concept.events','concept','Events','One thing causing another to happen, such as a button press triggering code.','concept','[{"framework":"brennan-resnick-2012","term":"events"}]',3);
INSERT INTO ontology_nodes VALUES('concept.parallelism','concept','Parallelism','Sequences of steps happening at the same time.','concept','[{"framework":"brennan-resnick-2012","term":"parallelism"}]',4);
INSERT INTO ontology_nodes VALUES('concept.conditionals','concept','Conditionals','Choosing what to do based on whether a condition is true.','concept','[{"framework":"brennan-resnick-2012","term":"conditionals"}]',5);
INSERT INTO ontology_nodes VALUES('concept.operators','concept','Operators','Mathematical, logical and string operations on values.','concept','[{"framework":"brennan-resnick-2012","term":"operators"}]',6);
INSERT INTO ontology_nodes VALUES('concept.operators.logic','concept','Logic operators','Combining conditions with AND, OR and NOT, and reasoning about which rule takes priority.','concept.operators','[{"framework":"ctquest","term":"finer grain under operators"}]',7);
INSERT INTO ontology_nodes VALUES('concept.data','concept','Data','Storing, retrieving and updating values.','concept','[{"framework":"brennan-resnick-2012","term":"data"}]',8);
INSERT INTO ontology_nodes VALUES('concept.data.variables','concept','Variables and state','Named values that change as a program or process runs.','concept.data','[{"framework":"ctquest","term":"finer grain under data"}]',9);
INSERT INTO ontology_nodes VALUES('concept.data.representation','concept','Data representation','Encoding information so a computer can store and process it.','concept.data','[{"framework":"ctquest","term":"finer grain under data"}]',10);
INSERT INTO ontology_nodes VALUES('concept.data.representation.binary','concept','Binary and counting states','Bits, how many states n bits can hold, and how many bits data needs.','concept.data.representation','[{"framework":"ctquest","term":"finer grain under data"}]',11);
INSERT INTO ontology_nodes VALUES('concept.data.representation.text','concept','Text and strings','Sequences of characters, pattern matching and simple text transformations.','concept.data.representation','[{"framework":"ctquest","term":"finer grain under data"}]',12);
INSERT INTO ontology_nodes VALUES('concept.data.representation.encryption','concept','Encryption','Transforming a message so only someone who knows the rule can read it.','concept.data.representation','[{"framework":"ctquest","term":"finer grain under data"}]',13);
INSERT INTO ontology_nodes VALUES('concept.data.structures','concept','Data structures','Lists, grids and graphs that organise data so it can be processed.','concept.data','[{"framework":"ctquest","term":"finer grain under data"}]',14);
INSERT INTO ontology_nodes VALUES('concept.data.structures.paths','concept','Paths and routing','Shortest, cheapest and counted routes through grids and graphs.','concept.data.structures','[{"framework":"ctquest","term":"finer grain under data"}]',15);
INSERT INTO ontology_nodes VALUES('concept.data.structures.search-sort','concept','Searching and sorting','Finding and ordering items in a collection, and comparing how much work each strategy needs in the worst case.','concept.data.structures','[{"framework":"ctquest","term":"finer grain under data"}]',16);
INSERT INTO ontology_nodes VALUES('practice','practice','Computational practices','Ways of working while solving problems computationally.',NULL,'[{"framework":"brennan-resnick-2012","term":"computational practices"}]',17);
INSERT INTO ontology_nodes VALUES('practice.experimenting-iterating','practice','Experimenting and iterating','Building a little, trying it, and improving it in cycles.','practice','[{"framework":"brennan-resnick-2012","term":"being incremental and iterative (experimenting and iterating)"}]',18);
INSERT INTO ontology_nodes VALUES('practice.testing-debugging','practice','Testing and debugging','Making sure things work, and finding and fixing the cause when they do not.','practice','[{"framework":"brennan-resnick-2012","term":"testing and debugging"}]',19);
INSERT INTO ontology_nodes VALUES('practice.testing-debugging.tracing','practice','Tracing and predicting','Stepping through a procedure or program by hand to predict exactly what it does.','practice.testing-debugging','[{"framework":"ctquest","term":"finer grain under testing and debugging"}]',20);
INSERT INTO ontology_nodes VALUES('practice.testing-debugging.edge-cases','practice','Choosing edge cases','Picking inputs, such as equal values or negative numbers, that expose mistakes.','practice.testing-debugging','[{"framework":"ctquest","term":"finer grain under testing and debugging"}]',21);
INSERT INTO ontology_nodes VALUES('practice.testing-debugging.reviewing-ai-code','practice','Reviewing AI-generated code','Reading code an AI assistant produced, predicting its behaviour and finding inputs where it fails.','practice.testing-debugging','[{"framework":"ctquest","term":"vibe coding"}]',22);
INSERT INTO ontology_nodes VALUES('practice.reusing-remixing','practice','Reusing and remixing','Making something by building on existing projects, code or ideas.','practice','[{"framework":"brennan-resnick-2012","term":"reusing and remixing"}]',23);
INSERT INTO ontology_nodes VALUES('practice.reusing-remixing.translating','practice','Translating between languages','Recognising the same algorithm written in different programming languages, such as Swift and Python.','practice.reusing-remixing','[{"framework":"ctquest","term":"finer grain under reusing and remixing"}]',24);
INSERT INTO ontology_nodes VALUES('practice.reusing-remixing.ai-assisted','practice','Building with AI assistants','Directing an AI assistant to produce code (vibe coding) and building on what it gives back.','practice.reusing-remixing','[{"framework":"ctquest","term":"vibe coding"}]',25);
INSERT INTO ontology_nodes VALUES('practice.abstracting-modularizing','practice','Abstracting and modularizing','Exploring connections between the whole and the parts; keeping the details that matter.','practice','[{"framework":"brennan-resnick-2012","term":"abstracting and modularizing"}]',26);
INSERT INTO ontology_nodes VALUES('practice.abstracting-modularizing.decomposition','practice','Decomposition','Breaking a problem into smaller parts that can be solved separately.','practice.abstracting-modularizing','[{"framework":"ctquest","term":"finer grain under abstracting and modularizing"}]',27);
INSERT INTO ontology_nodes VALUES('practice.abstracting-modularizing.generalisation','practice','Pattern recognition and generalisation','Spotting a repeating structure and using it to predict or to solve related problems.','practice.abstracting-modularizing','[{"framework":"ctquest","term":"finer grain under abstracting and modularizing"}]',28);
INSERT INTO ontology_nodes VALUES('practice.abstracting-modularizing.invariants','practice','Finding invariants','Noticing a property that every allowed move preserves and using it to rule states out.','practice.abstracting-modularizing','[{"framework":"ctquest","term":"finer grain under abstracting and modularizing"}]',29);
INSERT INTO ontology_nodes VALUES('perspective','perspective','Computational perspectives','How learners see themselves, others and the world in relation to computing.',NULL,'[{"framework":"brennan-resnick-2012","term":"computational perspectives"}]',30);
INSERT INTO ontology_nodes VALUES('perspective.expressing','perspective','Expressing','Seeing computation as a way to create and express ideas.','perspective','[{"framework":"brennan-resnick-2012","term":"expressing"}]',31);
INSERT INTO ontology_nodes VALUES('perspective.connecting','perspective','Connecting','Creating with and for other people.','perspective','[{"framework":"brennan-resnick-2012","term":"connecting"}]',32);
INSERT INTO ontology_nodes VALUES('perspective.questioning','perspective','Questioning','Asking questions about technology and how it works.','perspective','[{"framework":"brennan-resnick-2012","term":"questioning"}]',33);
INSERT INTO ontology_nodes VALUES('perspective.questioning.ai-output','perspective','Questioning AI output','Treating what an AI assistant produces as a claim to check rather than an answer to trust.','perspective.questioning','[{"framework":"ctquest","term":"vibe coding"}]',34);
CREATE TABLE ontology_edges (
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('parent_of', 'requires')),
        PRIMARY KEY (from_id, to_id, kind)
      );
INSERT INTO ontology_edges VALUES('concept','concept.sequences','parent_of');
INSERT INTO ontology_edges VALUES('concept','concept.loops','parent_of');
INSERT INTO ontology_edges VALUES('concept.loops','concept.sequences','requires');
INSERT INTO ontology_edges VALUES('concept','concept.events','parent_of');
INSERT INTO ontology_edges VALUES('concept.events','concept.sequences','requires');
INSERT INTO ontology_edges VALUES('concept','concept.parallelism','parent_of');
INSERT INTO ontology_edges VALUES('concept.parallelism','concept.sequences','requires');
INSERT INTO ontology_edges VALUES('concept','concept.conditionals','parent_of');
INSERT INTO ontology_edges VALUES('concept.conditionals','concept.sequences','requires');
INSERT INTO ontology_edges VALUES('concept','concept.operators','parent_of');
INSERT INTO ontology_edges VALUES('concept.operators','concept.operators.logic','parent_of');
INSERT INTO ontology_edges VALUES('concept.operators.logic','concept.conditionals','requires');
INSERT INTO ontology_edges VALUES('concept','concept.data','parent_of');
INSERT INTO ontology_edges VALUES('concept.data','concept.data.variables','parent_of');
INSERT INTO ontology_edges VALUES('concept.data.variables','concept.sequences','requires');
INSERT INTO ontology_edges VALUES('concept.data','concept.data.representation','parent_of');
INSERT INTO ontology_edges VALUES('concept.data.representation','concept.data.representation.binary','parent_of');
INSERT INTO ontology_edges VALUES('concept.data.representation','concept.data.representation.text','parent_of');
INSERT INTO ontology_edges VALUES('concept.data.representation.text','concept.data.representation.binary','requires');
INSERT INTO ontology_edges VALUES('concept.data.representation','concept.data.representation.encryption','parent_of');
INSERT INTO ontology_edges VALUES('concept.data.representation.encryption','concept.data.representation.text','requires');
INSERT INTO ontology_edges VALUES('concept.data','concept.data.structures','parent_of');
INSERT INTO ontology_edges VALUES('concept.data.structures','concept.data.variables','requires');
INSERT INTO ontology_edges VALUES('concept.data.structures','concept.data.structures.paths','parent_of');
INSERT INTO ontology_edges VALUES('concept.data.structures.paths','concept.loops','requires');
INSERT INTO ontology_edges VALUES('concept.data.structures','concept.data.structures.search-sort','parent_of');
INSERT INTO ontology_edges VALUES('concept.data.structures.search-sort','concept.loops','requires');
INSERT INTO ontology_edges VALUES('concept.data.structures.search-sort','concept.conditionals','requires');
INSERT INTO ontology_edges VALUES('practice','practice.experimenting-iterating','parent_of');
INSERT INTO ontology_edges VALUES('practice','practice.testing-debugging','parent_of');
INSERT INTO ontology_edges VALUES('practice.testing-debugging','practice.testing-debugging.tracing','parent_of');
INSERT INTO ontology_edges VALUES('practice.testing-debugging.tracing','concept.sequences','requires');
INSERT INTO ontology_edges VALUES('practice.testing-debugging','practice.testing-debugging.edge-cases','parent_of');
INSERT INTO ontology_edges VALUES('practice.testing-debugging.edge-cases','practice.testing-debugging.tracing','requires');
INSERT INTO ontology_edges VALUES('practice.testing-debugging','practice.testing-debugging.reviewing-ai-code','parent_of');
INSERT INTO ontology_edges VALUES('practice.testing-debugging.reviewing-ai-code','practice.testing-debugging.edge-cases','requires');
INSERT INTO ontology_edges VALUES('practice.testing-debugging.reviewing-ai-code','practice.reusing-remixing.ai-assisted','requires');
INSERT INTO ontology_edges VALUES('practice','practice.reusing-remixing','parent_of');
INSERT INTO ontology_edges VALUES('practice.reusing-remixing','practice.reusing-remixing.translating','parent_of');
INSERT INTO ontology_edges VALUES('practice.reusing-remixing.translating','concept.loops','requires');
INSERT INTO ontology_edges VALUES('practice.reusing-remixing','practice.reusing-remixing.ai-assisted','parent_of');
INSERT INTO ontology_edges VALUES('practice','practice.abstracting-modularizing','parent_of');
INSERT INTO ontology_edges VALUES('practice.abstracting-modularizing','practice.abstracting-modularizing.decomposition','parent_of');
INSERT INTO ontology_edges VALUES('practice.abstracting-modularizing','practice.abstracting-modularizing.generalisation','parent_of');
INSERT INTO ontology_edges VALUES('practice.abstracting-modularizing','practice.abstracting-modularizing.invariants','parent_of');
INSERT INTO ontology_edges VALUES('practice.abstracting-modularizing.invariants','practice.abstracting-modularizing.generalisation','requires');
INSERT INTO ontology_edges VALUES('perspective','perspective.expressing','parent_of');
INSERT INTO ontology_edges VALUES('perspective','perspective.connecting','parent_of');
INSERT INTO ontology_edges VALUES('perspective','perspective.questioning','parent_of');
INSERT INTO ontology_edges VALUES('perspective.questioning','perspective.questioning.ai-output','parent_of');
CREATE TABLE learning_outcomes (
        id TEXT PRIMARY KEY,
        statement TEXT NOT NULL,
        position INTEGER NOT NULL
      );
INSERT INTO learning_outcomes VALUES('LO-SEQ-1','Put the steps of a process in an order that always works, respecting constraints between steps.',0);
INSERT INTO learning_outcomes VALUES('LO-PAT-1','Spot a repeating pattern and use it to predict a later item.',1);
INSERT INTO learning_outcomes VALUES('LO-COND-1','Apply if/otherwise rules correctly, including rules with priority and conditions joined by AND or OR.',2);
INSERT INTO learning_outcomes VALUES('LO-TRACE-1','Trace a sequence, loop or branching procedure step by step to find its final state.',3);
INSERT INTO learning_outcomes VALUES('LO-DATA-1','Count the states that n on/off choices can represent and the bits a piece of data needs.',4);
INSERT INTO learning_outcomes VALUES('LO-PATH-1','Find shortest or cheapest routes, and count routes, in small grids and networks.',5);
INSERT INTO learning_outcomes VALUES('LO-EFF-1','Reason about the work a sorting or searching strategy needs and compare strategies by their worst case.',6);
INSERT INTO learning_outcomes VALUES('LO-DEBUG-1','Find the input where a rule or program behaves unexpectedly, such as equal values or an empty case.',7);
INSERT INTO learning_outcomes VALUES('LO-INV-1','Use a property that every move preserves to decide which states can never be reached.',8);
INSERT INTO learning_outcomes VALUES('LO-STR-1','Match patterns in strings and apply or reverse a simple cipher.',9);
INSERT INTO learning_outcomes VALUES('LO-CODE-TRACE-1','Predict the output of a short Python program that uses loops, conditionals and lists.',10);
INSERT INTO learning_outcomes VALUES('LO-AI-REVIEW-1','Find an input that exposes a bug in AI-generated code before trusting that code.',11);
INSERT INTO learning_outcomes VALUES('LO-TRANSLATE-1','Recognise the same algorithm written in Swift and in Python.',12);
CREATE TABLE outcome_nodes (
        outcome_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        PRIMARY KEY (outcome_id, node_id)
      );
INSERT INTO outcome_nodes VALUES('LO-SEQ-1','concept.sequences');
INSERT INTO outcome_nodes VALUES('LO-PAT-1','practice.abstracting-modularizing.generalisation');
INSERT INTO outcome_nodes VALUES('LO-COND-1','concept.conditionals');
INSERT INTO outcome_nodes VALUES('LO-COND-1','concept.operators.logic');
INSERT INTO outcome_nodes VALUES('LO-TRACE-1','concept.sequences');
INSERT INTO outcome_nodes VALUES('LO-TRACE-1','concept.loops');
INSERT INTO outcome_nodes VALUES('LO-TRACE-1','concept.data.variables');
INSERT INTO outcome_nodes VALUES('LO-TRACE-1','practice.testing-debugging.tracing');
INSERT INTO outcome_nodes VALUES('LO-DATA-1','concept.data.representation.binary');
INSERT INTO outcome_nodes VALUES('LO-PATH-1','concept.data.structures.paths');
INSERT INTO outcome_nodes VALUES('LO-EFF-1','concept.data.structures.search-sort');
INSERT INTO outcome_nodes VALUES('LO-DEBUG-1','practice.testing-debugging.edge-cases');
INSERT INTO outcome_nodes VALUES('LO-DEBUG-1','concept.conditionals');
INSERT INTO outcome_nodes VALUES('LO-INV-1','practice.abstracting-modularizing.invariants');
INSERT INTO outcome_nodes VALUES('LO-STR-1','concept.data.representation.text');
INSERT INTO outcome_nodes VALUES('LO-STR-1','concept.data.representation.encryption');
INSERT INTO outcome_nodes VALUES('LO-CODE-TRACE-1','concept.loops');
INSERT INTO outcome_nodes VALUES('LO-CODE-TRACE-1','concept.conditionals');
INSERT INTO outcome_nodes VALUES('LO-CODE-TRACE-1','concept.data.variables');
INSERT INTO outcome_nodes VALUES('LO-CODE-TRACE-1','concept.data.structures');
INSERT INTO outcome_nodes VALUES('LO-CODE-TRACE-1','practice.testing-debugging.tracing');
INSERT INTO outcome_nodes VALUES('LO-AI-REVIEW-1','practice.testing-debugging.reviewing-ai-code');
INSERT INTO outcome_nodes VALUES('LO-AI-REVIEW-1','practice.testing-debugging.edge-cases');
INSERT INTO outcome_nodes VALUES('LO-AI-REVIEW-1','perspective.questioning.ai-output');
INSERT INTO outcome_nodes VALUES('LO-TRANSLATE-1','practice.reusing-remixing.translating');
INSERT INTO outcome_nodes VALUES('LO-TRANSLATE-1','concept.loops');
CREATE TABLE outcome_levels (
        outcome_id TEXT NOT NULL,
        level TEXT NOT NULL,
        PRIMARY KEY (outcome_id, level)
      );
INSERT INTO outcome_levels VALUES('LO-SEQ-1','P5');
INSERT INTO outcome_levels VALUES('LO-SEQ-1','P6');
INSERT INTO outcome_levels VALUES('LO-PAT-1','P5');
INSERT INTO outcome_levels VALUES('LO-PAT-1','P6');
INSERT INTO outcome_levels VALUES('LO-COND-1','P5');
INSERT INTO outcome_levels VALUES('LO-COND-1','P6');
INSERT INTO outcome_levels VALUES('LO-COND-1','S1');
INSERT INTO outcome_levels VALUES('LO-TRACE-1','P5');
INSERT INTO outcome_levels VALUES('LO-TRACE-1','P6');
INSERT INTO outcome_levels VALUES('LO-TRACE-1','S1');
INSERT INTO outcome_levels VALUES('LO-DATA-1','P5');
INSERT INTO outcome_levels VALUES('LO-DATA-1','S1');
INSERT INTO outcome_levels VALUES('LO-PATH-1','P6');
INSERT INTO outcome_levels VALUES('LO-PATH-1','S2');
INSERT INTO outcome_levels VALUES('LO-EFF-1','P6');
INSERT INTO outcome_levels VALUES('LO-EFF-1','S2');
INSERT INTO outcome_levels VALUES('LO-DEBUG-1','S1');
INSERT INTO outcome_levels VALUES('LO-DEBUG-1','S2');
INSERT INTO outcome_levels VALUES('LO-INV-1','S2');
INSERT INTO outcome_levels VALUES('LO-STR-1','S2');
INSERT INTO outcome_levels VALUES('LO-CODE-TRACE-1','S1');
INSERT INTO outcome_levels VALUES('LO-CODE-TRACE-1','S2');
INSERT INTO outcome_levels VALUES('LO-AI-REVIEW-1','S1');
INSERT INTO outcome_levels VALUES('LO-AI-REVIEW-1','S2');
INSERT INTO outcome_levels VALUES('LO-TRANSLATE-1','S1');
INSERT INTO outcome_levels VALUES('LO-TRANSLATE-1','S2');
CREATE TABLE outcome_audiences (
        outcome_id TEXT NOT NULL,
        audience TEXT NOT NULL,
        PRIMARY KEY (outcome_id, audience)
      );
INSERT INTO outcome_audiences VALUES('LO-SEQ-1','core');
INSERT INTO outcome_audiences VALUES('LO-PAT-1','core');
INSERT INTO outcome_audiences VALUES('LO-COND-1','core');
INSERT INTO outcome_audiences VALUES('LO-TRACE-1','core');
INSERT INTO outcome_audiences VALUES('LO-DATA-1','core');
INSERT INTO outcome_audiences VALUES('LO-PATH-1','core');
INSERT INTO outcome_audiences VALUES('LO-EFF-1','core');
INSERT INTO outcome_audiences VALUES('LO-DEBUG-1','core');
INSERT INTO outcome_audiences VALUES('LO-DEBUG-1','rgsynapse');
INSERT INTO outcome_audiences VALUES('LO-INV-1','core');
INSERT INTO outcome_audiences VALUES('LO-STR-1','core');
INSERT INTO outcome_audiences VALUES('LO-CODE-TRACE-1','rgsynapse');
INSERT INTO outcome_audiences VALUES('LO-AI-REVIEW-1','rgsynapse');
INSERT INTO outcome_audiences VALUES('LO-TRANSLATE-1','rgsynapse');
CREATE TABLE bank_questions (
        id TEXT PRIMARY KEY,
        bank TEXT NOT NULL,
        type TEXT NOT NULL,
        audience TEXT NOT NULL,
        level TEXT NOT NULL,
        difficulty INTEGER NOT NULL,
        points INTEGER NOT NULL,
        position INTEGER NOT NULL,
        question_json TEXT NOT NULL
      );
INSERT INTO bank_questions VALUES('P5-01','core','mcq','core','P5',1,3,0,'{"id":"P5-01","type":"mcq","audience":"core","level":"P5","title":"Packing order","prompt":"A robot packs a snack box.\n\nSteps available:\n1) Put the sandwich into the box\n2) Close the box\n3) Put the note into the box\n\nWhich order always works?","options":["1, 2, 3","3, 2, 1","2, 1, 3","1, 3, 2"],"answer":{"index":3},"points":3,"difficulty":1,"ontology":["concept.sequences"],"outcomes":["LO-SEQ-1"],"crosswalk":{"bebrasCategory":"algorithms-programming"},"topic":"Sequencing","qType":"Order / process","details":"Tests reasoning about step order and constraints (can’t close box before inserting items).","bank":"core"}');
INSERT INTO bank_questions VALUES('P5-02','core','mcq','core','P5',1,3,1,'{"id":"P5-02","type":"mcq","audience":"core","level":"P5","title":"Sticker pattern","prompt":"A sticker machine prints this pattern repeatedly:\n\nCircle, Circle, Square, Circle, Circle, Square, ...\n\nWhat is the 9th sticker?","options":["Circle","Square","Triangle","It cannot be known"],"answer":{"index":1},"points":3,"difficulty":1,"ontology":["practice.abstracting-modularizing.generalisation"],"outcomes":["LO-PAT-1"],"crosswalk":{"bebrasCategory":"algorithms-programming"},"topic":"Patterns","qType":"Next in sequence","details":"Finds a repeating pattern and predicts a later position.","bank":"core"}');
INSERT INTO bank_questions VALUES('P5-03','core','mcq','core','P5',1,3,2,'{"id":"P5-03","type":"mcq","audience":"core","level":"P5","title":"Ticket rule","prompt":"A game gives a ticket based on the number you roll:\nIf the number is 1 or 2, you get a BLUE ticket.\nOtherwise, you get a RED ticket.\n\nYou roll a 4. What ticket do you get?","options":["BLUE","RED","Both","None"],"answer":{"index":1},"points":3,"difficulty":1,"ontology":["concept.conditionals"],"outcomes":["LO-COND-1"],"crosswalk":{"bebrasCategory":"algorithms-programming"},"topic":"Logic","qType":"If rule","details":"Applies a simple if/otherwise rule carefully.","bank":"core"}');
INSERT INTO bank_questions VALUES('P5-04','core','mcq','core','P5',1,3,3,'{"id":"P5-04","type":"mcq","audience":"core","level":"P5","title":"Turn the arrow","prompt":"An arrow points UP. You turn it right (clockwise) twice.\n\nWhere does it point now?","options":["Up","Down","Left","Right"],"answer":{"index":1},"points":3,"difficulty":1,"ontology":["concept.sequences","practice.testing-debugging.tracing"],"outcomes":["LO-TRACE-1"],"crosswalk":{"bebrasCategory":"algorithms-programming"},"topic":"Spatial reasoning","qType":"Rotation","details":"Mentally rotates an object by 90° steps.","bank":"core"}');
INSERT INTO bank_questions VALUES('P5-05','core','mcq','core','P5',1,3,4,'{"id":"P5-05","type":"mcq","audience":"core","level":"P5","title":"Light switches","prompt":"You have 3 light switches. Each switch can be ON or OFF.\n\nHow many different switch patterns are possible?","options":["3","6","8","9"],"answer":{"index":2},"points":3,"difficulty":1,"ontology":["concept.data.representation.binary"],"outcomes":["LO-DATA-1"],"crosswalk":{"bebrasCategory":"data-structures-representations"},"topic":"Information","qType":"Counting states","details":"Counts how many outcomes exist for multiple ON/OFF choices.","bank":"core"}');
INSERT INTO bank_questions VALUES('P6-01','core','mcq','core','P6',2,4,5,'{"id":"P6-01","type":"mcq","audience":"core","level":"P6","title":"Shortest safe walk","prompt":"You are at S and want to reach T.\nYou can move up/down/left/right.\nYou cannot step on #.\n\n","art":"S . . .\n# # . #\n. . . #\n. # . T","options":["6 steps","7 steps","8 steps","9 steps"],"answer":{"index":0},"points":4,"difficulty":2,"ontology":["concept.data.structures.paths"],"outcomes":["LO-PATH-1"],"crosswalk":{"bebrasCategory":"algorithms-programming"},"topic":"Grids / paths","qType":"Shortest path","details":"Finds a shortest path length on a grid while avoiding obstacles.","bank":"core"}');
INSERT INTO bank_questions VALUES('P6-02','core','mcq','core','P6',2,4,6,'{"id":"P6-02","type":"mcq","audience":"core","level":"P6","title":"Stamping cards","prompt":"A machine starts at 0 points.\nIt repeats 5 times:\nAdd 2 points.\n\nHow many points at the end?","options":["7","8","9","10"],"answer":{"index":3},"points":4,"difficulty":2,"ontology":["concept.loops","concept.data.variables","practice.testing-debugging.tracing"],"outcomes":["LO-TRACE-1"],"crosswalk":{"bebrasCategory":"algorithms-programming"},"topic":"Loops","qType":"Repeated action","details":"Simulates a loop and computes the final total.","bank":"core"}');
INSERT INTO bank_questions VALUES('P6-03','core','mcq','core','P6',2,4,7,'{"id":"P6-03","type":"mcq","audience":"core","level":"P6","title":"Neighbour swaps","prompt":"You have: 2 4 1 3\nYou may swap only neighbouring numbers.\n\nMinimum swaps to sort into 1 2 3 4?","options":["2","3","4","5"],"answer":{"index":1},"points":4,"difficulty":2,"ontology":["concept.data.structures.search-sort"],"outcomes":["LO-EFF-1"],"crosswalk":{"bebrasCategory":"algorithms-programming"},"topic":"Sorting","qType":"Minimum swaps (adjacent)","details":"Counts the minimum neighbouring swaps needed to sort (inversions).","bank":"core"}');
INSERT INTO bank_questions VALUES('P6-04','core','mcq','core','P6',2,4,8,'{"id":"P6-04","type":"mcq","audience":"core","level":"P6","title":"Bonus points","prompt":"A quiz gives points like this:\n- Correct answer: +2\n- Extra bonus: If you answer correctly AND in under 10 seconds, you get +5 total (not +2).\n\nYou answer correctly in 8 seconds. How many points do you get?","options":["2","5","7","10"],"answer":{"index":1},"points":4,"difficulty":2,"ontology":["concept.conditionals","concept.operators.logic"],"outcomes":["LO-COND-1"],"crosswalk":{"bebrasCategory":"algorithms-programming"},"topic":"Conditions","qType":"Rule with priority","details":"Special-case rule overrides normal scoring.","bank":"core"}');
INSERT INTO bank_questions VALUES('P6-05','core','mcq','core','P6',2,4,9,'{"id":"P6-05","type":"mcq","audience":"core","level":"P6","title":"Two-step routes","prompt":"A can connect to B and C.\nB can connect to D.\nC can connect to D.\n\nHow many different shortest routes are there from A to D?","options":["1","2","3","4"],"answer":{"index":1},"points":4,"difficulty":2,"ontology":["concept.data.structures.paths"],"outcomes":["LO-PATH-1"],"crosswalk":{"bebrasCategory":"communication-networking"},"topic":"Networks","qType":"Count shortest routes","details":"Counts distinct shortest routes in a small network.","bank":"core"}');
INSERT INTO bank_questions VALUES('S1-01','core','mcq','core','S1',3,5,10,'{"id":"S1-01","type":"mcq","audience":"core","level":"S1","title":"Pick the larger number","prompt":"A student writes this rule to return the larger of A and B:\n\nIf A > B, return A\nElse return B\n\nWhen A = 3 and B = 3, which line runs?","options":["The first line runs and returns A","The Else line runs and returns B","It crashes","It returns nothing"],"answer":{"index":1},"points":5,"difficulty":3,"ontology":["practice.testing-debugging.edge-cases","concept.conditionals"],"outcomes":["LO-DEBUG-1"],"crosswalk":{"bebrasCategory":"algorithms-programming"},"topic":"Debugging","qType":"Edge case / equality","details":"Tests understanding of comparisons when values are equal.","bank":"core"}');
INSERT INTO bank_questions VALUES('S1-02','core','mcq','core','S1',3,5,11,'{"id":"S1-02","type":"mcq","audience":"core","level":"S1","title":"How many codes?","prompt":"A locker code uses exactly 4 bits (0/1).\n\nHow many different codes are possible?","options":["4","8","12","16"],"answer":{"index":3},"points":5,"difficulty":3,"ontology":["concept.data.representation.binary"],"outcomes":["LO-DATA-1"],"crosswalk":{"bebrasCategory":"data-structures-representations"},"topic":"Binary","qType":"Bit counting","details":"Uses 2^n outcomes for n bits.","bank":"core"}');
INSERT INTO bank_questions VALUES('S1-03','core','mcq','core','S1',3,5,12,'{"id":"S1-03","type":"mcq","audience":"core","level":"S1","title":"Even-odd machine","prompt":"Start with the number 10.\nRepeat exactly 3 times:\n- If the number is even, divide by 2\n- If the number is odd, add 3\n\nWhat is the final number?","options":["4","5","6","7"],"answer":{"index":0},"points":5,"difficulty":3,"ontology":["concept.loops","concept.conditionals","practice.testing-debugging.tracing"],"outcomes":["LO-TRACE-1"],"crosswalk":{"bebrasCategory":"algorithms-programming"},"topic":"Algorithms","qType":"Trace a procedure","details":"Traces a branching procedure across fixed iterations.","bank":"core"}');
INSERT INTO bank_questions VALUES('S1-04','core','mcq','core','S1',3,5,13,'{"id":"S1-04","type":"mcq","audience":"core","level":"S1","title":"Pixel storage","prompt":"A 5×5 black/white image uses 1 bit per pixel.\n\nHow many bits are needed in total?","options":["10","15","20","25"],"answer":{"index":3},"points":5,"difficulty":3,"ontology":["concept.data.representation.binary"],"outcomes":["LO-DATA-1"],"crosswalk":{"bebrasCategory":"data-structures-representations"},"topic":"Data representation","qType":"Encoding size","details":"Computes bits needed: pixels × bits per pixel.","bank":"core"}');
INSERT INTO bank_questions VALUES('S1-05','core','mcq','core','S1',3,5,14,'{"id":"S1-05","type":"mcq","audience":"core","level":"S1","title":"Club entry rule","prompt":"A club rule says:\nYou may enter if you have a PASS OR you are with a TEACHER.\n\nYou have no pass, but you are with a teacher.\nCan you enter?","options":["Yes","No","Only on weekends","Not enough information"],"answer":{"index":0},"points":5,"difficulty":3,"ontology":["concept.operators.logic"],"outcomes":["LO-COND-1"],"crosswalk":{"bebrasCategory":"algorithms-programming"},"topic":"Logic","qType":"OR condition","details":"Understands OR: either condition is enough.","bank":"core"}');
INSERT INTO bank_questions VALUES('S2-01','core','mcq','core','S2',4,6,15,'{"id":"S2-01","type":"mcq","audience":"core","level":"S2","title":"Finding a name","prompt":"A list has 100 names.\nStrategy A: start from the top and check one by one.\nStrategy B: the list is sorted, so you can repeatedly check the middle and cut the list in half.\n\nIn the worst case, which strategy uses fewer checks?","options":["A","B","Same","Cannot compare"],"answer":{"index":1},"points":6,"difficulty":4,"ontology":["concept.data.structures.search-sort"],"outcomes":["LO-EFF-1"],"crosswalk":{"bebrasCategory":"algorithms-programming"},"topic":"Efficiency","qType":"Compare strategies","details":"Chooses strategy with fewer checks in the worst case (binary search idea).","bank":"core"}');
INSERT INTO bank_questions VALUES('S2-02','core','mcq','core','S2',4,6,16,'{"id":"S2-02","type":"mcq","audience":"core","level":"S2","title":"Cheapest route","prompt":"A delivery bot can travel these paths (cost in minutes):\nA→B (2), A→C (5), B→D (6), C→D (1), B→C (1)\n\nWhat is the cheapest cost from A to D?","options":["4","6","7","8"],"answer":{"index":0},"points":6,"difficulty":4,"ontology":["concept.data.structures.paths"],"outcomes":["LO-PATH-1"],"crosswalk":{"bebrasCategory":"algorithms-programming"},"topic":"Graphs / routing","qType":"Cheapest path (weighted)","details":"Finds minimum total cost, not minimum number of steps.","bank":"core"}');
INSERT INTO bank_questions VALUES('S2-03','core','mcq','core','S2',4,6,17,'{"id":"S2-03","type":"mcq","audience":"core","level":"S2","title":"Colour flips","prompt":"You have 6 tiles in a row, all WHITE.\nOne move flips exactly 2 neighbouring tiles (WHITE↔BLACK).\n\nAfter any number of moves, which situation is impossible?","options":["0 black tiles","1 black tile","2 black tiles","4 black tiles"],"answer":{"index":1},"points":6,"difficulty":4,"ontology":["practice.abstracting-modularizing.invariants"],"outcomes":["LO-INV-1"],"crosswalk":{"bebrasCategory":"algorithms-programming"},"topic":"Invariants","qType":"Parity / impossible state","details":"Flipping 2 tiles keeps number of black tiles even.","bank":"core"}');
INSERT INTO bank_questions VALUES('S2-04','core','mcq','core','S2',4,6,18,'{"id":"S2-04","type":"mcq","audience":"core","level":"S2","title":"Counting blocks","prompt":"A code is: ABABABAA\n\nHow many times does the block ''ABA'' appear if overlaps ARE allowed?","options":["1","2","3","4"],"answer":{"index":2},"points":6,"difficulty":4,"ontology":["concept.data.representation.text"],"outcomes":["LO-STR-1"],"crosswalk":{"bebrasCategory":"data-structures-representations"},"topic":"Strings","qType":"Pattern matching (overlaps)","details":"Counts substring occurrences allowing overlaps.","bank":"core"}');
INSERT INTO bank_questions VALUES('S2-05','core','mcq','core','S2',4,6,19,'{"id":"S2-05","type":"mcq","audience":"core","level":"S2","title":"Shift message","prompt":"A message uses this rule:\nA→D, B→E, C→F, ... (each letter shifts forward by 3)\n\nThe coded word is: KHOOR\nWhat is the original word?","options":["HELLO","KELLY","HOLLY","KHOOR"],"answer":{"index":0},"points":6,"difficulty":4,"ontology":["concept.data.representation.encryption"],"outcomes":["LO-STR-1"],"crosswalk":{"bebrasCategory":"communication-networking"},"topic":"Cryptography basics","qType":"Caesar shift decode","details":"Decodes by shifting letters backward by 3.","bank":"core"}');
INSERT INTO bank_questions VALUES('RGS-S1-01','rgsynapse','mcq','rgsynapse','S1',3,5,20,'{"id":"RGS-S1-01","type":"mcq","audience":"rgsynapse","level":"S1","title":"Odd and even totals","prompt":"What does this Python program print?","code":{"language":"python","source":"total = 0\nfor i in range(1, 6):\n    if i % 2 == 0:\n        total += i\n    else:\n        total -= 1\nprint(total)"},"options":["3","5","6","9"],"answer":{"index":0},"points":5,"difficulty":3,"ontology":["concept.loops","concept.conditionals","concept.data.variables","practice.testing-debugging.tracing"],"outcomes":["LO-CODE-TRACE-1"],"crosswalk":{"bebrasCategory":"algorithms-programming"},"topic":"Code tracing","qType":"Predict the output","details":"Traces a loop with a branch inside it, including where range() stops.","bank":"rgsynapse"}');
INSERT INTO bank_questions VALUES('RGS-S1-02','rgsynapse','mcq','rgsynapse','S1',3,5,21,'{"id":"RGS-S1-02","type":"mcq","audience":"rgsynapse","level":"S1","title":"Checking the AI''s answer","prompt":"You asked an AI assistant for a Python function that returns the largest number in a list. It wrote the code below.\n\nWhich test input shows that the function has a bug?","code":{"language":"python","source":"def largest(nums):\n    best = 0\n    for n in nums:\n        if n > best:\n            best = n\n    return best"},"options":["[3, 8, 2]","[5]","[-4, -2, -7]","[1, 1, 1]"],"answer":{"index":2},"points":5,"difficulty":3,"ontology":["practice.testing-debugging.reviewing-ai-code","practice.testing-debugging.edge-cases","concept.data.variables"],"outcomes":["LO-AI-REVIEW-1","LO-DEBUG-1"],"crosswalk":{"bebrasCategory":"algorithms-programming"},"topic":"Reviewing AI code","qType":"Find the failing input","details":"Chooses a test case that exposes a wrong starting value.","bank":"rgsynapse"}');
INSERT INTO bank_questions VALUES('RGS-S2-01','rgsynapse','mcq','rgsynapse','S2',4,6,22,'{"id":"RGS-S2-01","type":"mcq","audience":"rgsynapse","level":"S2","title":"Swift to Python","prompt":"This Swift loop prints some numbers. Which Python loop prints exactly the same numbers in the same order?","code":{"language":"swift","source":"for i in stride(from: 10, to: 0, by: -3) {\n    print(i)\n}"},"options":["for i in range(10, 0, -3):","for i in range(10, 1, -3):","for i in range(0, 10, 3):","for i in range(10, 0, 3):"],"answer":{"index":0},"points":6,"difficulty":4,"ontology":["practice.reusing-remixing.translating","concept.loops"],"outcomes":["LO-TRANSLATE-1"],"crosswalk":{"bebrasCategory":"algorithms-programming"},"topic":"Swift and Python","qType":"Equivalent loops","details":"Compares loop bounds and step direction across two languages.","bank":"rgsynapse"}');
INSERT INTO bank_questions VALUES('RGS-S2-02','rgsynapse','mcq','rgsynapse','S2',4,6,23,'{"id":"RGS-S2-02","type":"mcq","audience":"rgsynapse","level":"S2","title":"Counting passes","prompt":"An AI assistant wrote this code to count how many scores are 50 or more.\n\nWhat does it print?","code":{"language":"python","source":"scores = [72, 45, 50, 38, 91]\ncount = 0\nfor i in range(1, len(scores)):\n    if scores[i] >= 50:\n        count += 1\nprint(count)"},"options":["2","3","4","5"],"answer":{"index":0},"points":6,"difficulty":4,"ontology":["practice.testing-debugging.reviewing-ai-code","concept.loops","concept.data.structures","practice.testing-debugging.tracing"],"outcomes":["LO-CODE-TRACE-1","LO-AI-REVIEW-1"],"crosswalk":{"bebrasCategory":"algorithms-programming"},"topic":"Reviewing AI code","qType":"Predict the output","details":"Traces list indexing and notices which items the loop skips.","bank":"rgsynapse"}');
CREATE TABLE question_nodes (
        question_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        PRIMARY KEY (question_id, node_id)
      );
INSERT INTO question_nodes VALUES('P5-01','concept.sequences');
INSERT INTO question_nodes VALUES('P5-02','practice.abstracting-modularizing.generalisation');
INSERT INTO question_nodes VALUES('P5-03','concept.conditionals');
INSERT INTO question_nodes VALUES('P5-04','concept.sequences');
INSERT INTO question_nodes VALUES('P5-04','practice.testing-debugging.tracing');
INSERT INTO question_nodes VALUES('P5-05','concept.data.representation.binary');
INSERT INTO question_nodes VALUES('P6-01','concept.data.structures.paths');
INSERT INTO question_nodes VALUES('P6-02','concept.loops');
INSERT INTO question_nodes VALUES('P6-02','concept.data.variables');
INSERT INTO question_nodes VALUES('P6-02','practice.testing-debugging.tracing');
INSERT INTO question_nodes VALUES('P6-03','concept.data.structures.search-sort');
INSERT INTO question_nodes VALUES('P6-04','concept.conditionals');
INSERT INTO question_nodes VALUES('P6-04','concept.operators.logic');
INSERT INTO question_nodes VALUES('P6-05','concept.data.structures.paths');
INSERT INTO question_nodes VALUES('S1-01','practice.testing-debugging.edge-cases');
INSERT INTO question_nodes VALUES('S1-01','concept.conditionals');
INSERT INTO question_nodes VALUES('S1-02','concept.data.representation.binary');
INSERT INTO question_nodes VALUES('S1-03','concept.loops');
INSERT INTO question_nodes VALUES('S1-03','concept.conditionals');
INSERT INTO question_nodes VALUES('S1-03','practice.testing-debugging.tracing');
INSERT INTO question_nodes VALUES('S1-04','concept.data.representation.binary');
INSERT INTO question_nodes VALUES('S1-05','concept.operators.logic');
INSERT INTO question_nodes VALUES('S2-01','concept.data.structures.search-sort');
INSERT INTO question_nodes VALUES('S2-02','concept.data.structures.paths');
INSERT INTO question_nodes VALUES('S2-03','practice.abstracting-modularizing.invariants');
INSERT INTO question_nodes VALUES('S2-04','concept.data.representation.text');
INSERT INTO question_nodes VALUES('S2-05','concept.data.representation.encryption');
INSERT INTO question_nodes VALUES('RGS-S1-01','concept.loops');
INSERT INTO question_nodes VALUES('RGS-S1-01','concept.conditionals');
INSERT INTO question_nodes VALUES('RGS-S1-01','concept.data.variables');
INSERT INTO question_nodes VALUES('RGS-S1-01','practice.testing-debugging.tracing');
INSERT INTO question_nodes VALUES('RGS-S1-02','practice.testing-debugging.reviewing-ai-code');
INSERT INTO question_nodes VALUES('RGS-S1-02','practice.testing-debugging.edge-cases');
INSERT INTO question_nodes VALUES('RGS-S1-02','concept.data.variables');
INSERT INTO question_nodes VALUES('RGS-S2-01','practice.reusing-remixing.translating');
INSERT INTO question_nodes VALUES('RGS-S2-01','concept.loops');
INSERT INTO question_nodes VALUES('RGS-S2-02','practice.testing-debugging.reviewing-ai-code');
INSERT INTO question_nodes VALUES('RGS-S2-02','concept.loops');
INSERT INTO question_nodes VALUES('RGS-S2-02','concept.data.structures');
INSERT INTO question_nodes VALUES('RGS-S2-02','practice.testing-debugging.tracing');
CREATE TABLE question_outcomes (
        question_id TEXT NOT NULL,
        outcome_id TEXT NOT NULL,
        PRIMARY KEY (question_id, outcome_id)
      );
INSERT INTO question_outcomes VALUES('P5-01','LO-SEQ-1');
INSERT INTO question_outcomes VALUES('P5-02','LO-PAT-1');
INSERT INTO question_outcomes VALUES('P5-03','LO-COND-1');
INSERT INTO question_outcomes VALUES('P5-04','LO-TRACE-1');
INSERT INTO question_outcomes VALUES('P5-05','LO-DATA-1');
INSERT INTO question_outcomes VALUES('P6-01','LO-PATH-1');
INSERT INTO question_outcomes VALUES('P6-02','LO-TRACE-1');
INSERT INTO question_outcomes VALUES('P6-03','LO-EFF-1');
INSERT INTO question_outcomes VALUES('P6-04','LO-COND-1');
INSERT INTO question_outcomes VALUES('P6-05','LO-PATH-1');
INSERT INTO question_outcomes VALUES('S1-01','LO-DEBUG-1');
INSERT INTO question_outcomes VALUES('S1-02','LO-DATA-1');
INSERT INTO question_outcomes VALUES('S1-03','LO-TRACE-1');
INSERT INTO question_outcomes VALUES('S1-04','LO-DATA-1');
INSERT INTO question_outcomes VALUES('S1-05','LO-COND-1');
INSERT INTO question_outcomes VALUES('S2-01','LO-EFF-1');
INSERT INTO question_outcomes VALUES('S2-02','LO-PATH-1');
INSERT INTO question_outcomes VALUES('S2-03','LO-INV-1');
INSERT INTO question_outcomes VALUES('S2-04','LO-STR-1');
INSERT INTO question_outcomes VALUES('S2-05','LO-STR-1');
INSERT INTO question_outcomes VALUES('RGS-S1-01','LO-CODE-TRACE-1');
INSERT INTO question_outcomes VALUES('RGS-S1-02','LO-AI-REVIEW-1');
INSERT INTO question_outcomes VALUES('RGS-S1-02','LO-DEBUG-1');
INSERT INTO question_outcomes VALUES('RGS-S2-01','LO-TRANSLATE-1');
INSERT INTO question_outcomes VALUES('RGS-S2-02','LO-CODE-TRACE-1');
INSERT INTO question_outcomes VALUES('RGS-S2-02','LO-AI-REVIEW-1');
INSERT INTO sqlite_sequence VALUES('users',1);
INSERT INTO sqlite_sequence VALUES('events',3);
INSERT INTO sqlite_sequence VALUES('event_questions',27);
INSERT INTO sqlite_sequence VALUES('attempts',6);
INSERT INTO sqlite_sequence VALUES('users',1);
INSERT INTO sqlite_sequence VALUES('events',2);
INSERT INTO sqlite_sequence VALUES('event_questions',25);
INSERT INTO sqlite_sequence VALUES('attempts',4);
INSERT INTO sqlite_sequence VALUES('answers',82);
CREATE INDEX idx_events_created_by ON events (created_by, created_at);
CREATE INDEX idx_event_questions_event ON event_questions (event_id, question_order);
CREATE INDEX idx_attempts_event ON attempts (event_id, started_at);
CREATE INDEX idx_answers_attempt ON answers (attempt_id);
CREATE INDEX idx_ontology_edges_to ON ontology_edges (to_id, kind);
CREATE INDEX idx_outcome_levels_level ON outcome_levels (level);
CREATE INDEX idx_bank_questions_filter ON bank_questions (audience, level, type, difficulty);
CREATE INDEX idx_question_nodes_node ON question_nodes (node_id);
CREATE INDEX idx_question_outcomes_outcome ON question_outcomes (outcome_id);
COMMIT;
