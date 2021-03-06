(function() {

    var s = new ShardingTest({name: "migrateBig", shards: 2, other: {chunkSize: 1}});

    s.config.settings.update({_id: "balancer"}, {$set: {_waitForDelete: true}}, true);
    s.adminCommand({enablesharding: "test"});
    s.ensurePrimaryShard('test', 'shard0001');
    s.adminCommand({shardcollection: "test.foo", key: {x: 1}});

    db = s.getDB("test");
    coll = db.foo;

    big = "";
    while (big.length < 10000)
        big += "eliot";

    var bulk = coll.initializeUnorderedBulkOp();
    for (x = 0; x < 100; x++) {
        bulk.insert({x: x, big: big});
    }
    assert.writeOK(bulk.execute());

    s.printShardingStatus();

    s.adminCommand({split: "test.foo", middle: {x: 30}});
    s.adminCommand({split: "test.foo", middle: {x: 66}});
    s.adminCommand(
        {movechunk: "test.foo", find: {x: 90}, to: s.getOther(s.getPrimaryShard("test")).name});

    s.printShardingStatus();

    print("YO : " + s.getPrimaryShard("test").host);
    direct = new Mongo(s.getPrimaryShard("test").host);
    print("direct : " + direct);

    directDB = direct.getDB("test");

    for (done = 0; done < 2 * 1024 * 1024; done += big.length) {
        assert.writeOK(directDB.foo.insert({x: 50 + Math.random(), big: big}));
    }

    s.printShardingStatus();

    assert.throws(function() {
        s.adminCommand({
            movechunk: "test.foo",
            find: {x: 50},
            to: s.getOther(s.getPrimaryShard("test")).name
        });
    }, [], "move should fail");

    for (i = 0; i < 20; i += 2) {
        try {
            s.adminCommand({split: "test.foo", middle: {x: i}});
        } catch (e) {
            // we may have auto split on some of these
            // which is ok
            print(e);
        }
    }

    s.printShardingStatus();

    s.config.settings.update({_id: "balancer"}, {$set: {stopped: false}}, true);

    assert.soon(function() {
        var x = s.chunkDiff("foo", "test");
        print("chunk diff: " + x);
        return x < 2;
    }, "no balance happened", 8 * 60 * 1000, 2000);

    assert.soon(function() {
        return !s.isAnyBalanceInFlight();
    });

    assert.eq(coll.count(), coll.find().itcount());

    s.stop();

})();
