module.exports = function (RED) {
  const nsq = require('nsqjs');

  function NsqConsumer(config) {
    RED.nodes.createNode(this, config);
    var node = this;
    node.connection = RED.nodes.getNode(config.connection);
    node.topic = config.topic; // 默认 topic
    node.channel = config.channel; // 默认 channel
    node.count = 0;
    node.finishImmediately = config.finishImmediately;
    node.pendingMessages = {};
    node.currentConsumer = null; // 当前的消费者实例

    node.status({ fill: "red", shape: "ring", text: "Not Ready" });

    // 创建消费者实例
    function createConsumer(topic, channel) {
 
      const consumer = new nsq.Reader(topic, channel, {
        nsqdTCPAddresses: [node.connection.host + ":" + node.connection.port],
        maxInFlight: parseInt(config.maxInFlight || 1),
        maxAttempts: parseInt(config.maxAttempts || 0),
      });

      consumer.on('error', err => {
        node.error(err);
      });

      consumer.on('ready', () => {
        node.status({ fill: "green", shape: "ring", text: `Ready (${node.count})` });
      });

      consumer.on('not_ready', () => {
        node.status({ fill: "red", shape: "ring", text: "Not Ready" });
      });

      consumer.on('message', msg => {
        node.count++;
        node.status({ fill: "green", shape: "ring", text: `Ready (${node.count})` });

        let payload;
        try {
          payload = msg.json();
        } catch (e) {
          payload = msg.body.toString();
        }

        if (node.finishImmediately) msg.finish();
        else node.pendingMessages[msg.id] = msg;

        node.send({
          _nsq: {
            id: msg.id,
            node_id: node.id,
            timestamp: msg.timestamp,
            attempts: msg.attempts,
            timeout: msg.timeUntilTimeout() / 1000,
            has_responded: node.finishImmediately,
          },
          payload,
        });
      });

      return consumer;
    }

  
    // 消息处理逻辑
    node.on('input', msg => {
      const dynamicTopic = msg.topic || node.topic;
      const dynamicChannel = msg.channel || node.channel;
      node.currentConsumer=createConsumer(dynamicTopic, dynamicChannel);
  
    });

    node.finishMessage = function (msg) {
      if (typeof msg._nsq != "object") return;
      let pmsg = node.pendingMessages[msg._nsq.id];
      if (!pmsg) return;

      pmsg.finish();
      delete node.pendingMessages[msg._nsq.id];
      msg._nsq.has_responded = true;
    };

    node.touchMessage = function (msg) {
      if (typeof msg._nsq != "object") return;
      let pmsg = node.pendingMessages[msg._nsq.id];
      if (!pmsg) return;

      pmsg.touch();
      msg._nsq.timeout = pmsg.timeUntilTimeout() / 1000;
    };

    node.requeueMessage = function (msg, delay, backoff) {
      if (typeof msg._nsq != "object") return;
      let pmsg = node.pendingMessages[msg._nsq.id];
      if (!pmsg) return;

      pmsg.requeue(delay * 1000, backoff);
      msg._nsq.has_responded = true;
    };

    node.on('close', () => {
      if (node.currentConsumer) {
        node.currentConsumer.close();
      }
    });

    if (node.currentConsumer){
      try {
        node.currentConsumer.connect()
      } catch (e) {
        node.error(e)
        node.status({ fill: "red", shape: "ring", text: "Can't connect!" })
      }
    }

  }

  RED.nodes.registerType("nsq-consumer", NsqConsumer);
};